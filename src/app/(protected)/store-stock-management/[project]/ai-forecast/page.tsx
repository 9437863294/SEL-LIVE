
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import type { InventoryLog, BoqItem, Project } from '@/lib/types';
import { format, subMonths, addMonths } from 'date-fns';

interface ForecastData {
  month: string;
  historical: number | null;
  predicted: number | null;
}

const getItemDescription = (item: BoqItem): string => {
    const descriptionKeys = ['Description', 'DESCRIPTION OF ITEMS'];
    for (const key of descriptionKeys) {
      if ((item as any)[key]) return String((item as any)[key]);
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? String((item as any)[fallbackKey]) : 'No Description';
};

export default function AiForecastPage() {
  const params = useParams();
  const projectSlug = params.project as string;
  const { toast } = useToast();
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!projectSlug) return;
    const fetchData = async () => {
        setIsLoading(true);
        try {
            const projectsQuery = query(collection(db, 'projects'));
            const projectsSnapshot = await getDocs(projectsQuery);
            const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
            const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

            if (!projectData) {
                toast({ title: "Error", description: "Project not found.", variant: "destructive" });
                setIsLoading(false);
                return;
            }
            setCurrentProject(projectData);

            const boqQuery = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
            const inventoryQuery = query(collection(db, 'inventoryLogs'), where('projectId', '==', projectData.id));
            
            const [boqSnapshot, inventorySnapshot] = await Promise.all([
                getDocs(boqQuery),
                getDocs(inventoryQuery)
            ]);

            const boqData = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
            setBoqItems(boqData);
            if(boqData.length > 0) {
                setSelectedItemId(boqData[0].id);
            }
            
            const inventoryData = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryLog));
            setInventoryLogs(inventoryData);

        } catch (error) {
            console.error("Error fetching forecast data:", error);
            toast({ title: 'Error', description: 'Failed to fetch initial data.', variant: 'destructive' });
        }
        setIsLoading(false);
    };
    fetchData();
  }, [projectSlug, toast]);

  const forecastData = useMemo((): { chartData: ForecastData[], stats: Record<string, any> } => {
    if (!selectedItemId || !inventoryLogs.length) return { chartData: [], stats: {} };

    const now = new Date();
    const historicalData: Record<string, number> = {};
    const monthlyConsumption: Record<string, number> = {};

    // Initialize historical months
    for (let i = 5; i >= 0; i--) {
      const monthKey = format(subMonths(now, i), 'MMM yyyy');
      historicalData[monthKey] = 0;
      monthlyConsumption[monthKey] = 0;
    }

    // Calculate historical consumption
    inventoryLogs.forEach(log => {
      if (log.itemId === selectedItemId && log.transactionType === 'Goods Issue') {
        const monthKey = format(log.date.toDate(), 'MMM yyyy');
        if (historicalData.hasOwnProperty(monthKey)) {
          monthlyConsumption[monthKey] += log.quantity;
        }
      }
    });

    const historicalValues = Object.values(monthlyConsumption);
    const averageConsumption = historicalValues.reduce((a, b) => a + b, 0) / (historicalValues.filter(v => v > 0).length || 1);
    const trend = (historicalValues[5] || 0) > (historicalValues[0] || 0) ? 1.1 : 0.9;
    
    // Generate Forecast
    let lastValue = historicalValues[5] || averageConsumption;
    const predictedData: Record<string, number> = {};
    for (let i = 1; i <= 3; i++) {
        const monthKey = format(addMonths(now, i), 'MMM yyyy');
        lastValue = lastValue * trend * (0.95 + Math.random() * 0.1); // Add some noise
        predictedData[monthKey] = Math.max(0, Math.round(lastValue));
    }

    // Combine into chart data
    const chartData: ForecastData[] = [];
    Object.keys(historicalData).forEach(month => {
        chartData.push({ month, historical: monthlyConsumption[month], predicted: null });
    });
    chartData.push({ month: format(now, 'MMM yyyy'), historical: monthlyConsumption[format(now, 'MMM yyyy')], predicted: monthlyConsumption[format(now, 'MMM yyyy')] });
    Object.keys(predictedData).forEach(month => {
        chartData.push({ month, historical: null, predicted: predictedData[month] });
    });
    
    // Calculate stats
    const currentStock = inventoryLogs
        .filter(log => log.itemId === selectedItemId)
        .reduce((balance, log) => {
            if (log.transactionType === 'Goods Receipt') return balance + log.availableQuantity;
            // Note: This is a simplified balance calc. A real one would be more complex.
            return balance;
        }, 0) - inventoryLogs.filter(log => log.itemId === selectedItemId && log.transactionType === 'Goods Issue').reduce((sum, log) => sum + log.quantity, 0);

    const predictedUsageNext3Months = Object.values(predictedData).reduce((a, b) => a + b, 0);
    const recommendedReorderQty = Math.max(0, predictedUsageNext3Months - currentStock);
    
    let stockOutMonth = 'N/A';
    let runningStock = currentStock;
    for (const month of Object.keys(predictedData)) {
      runningStock -= predictedData[month];
      if (runningStock <= 0) {
        stockOutMonth = month;
        break;
      }
    }


    return {
      chartData,
      stats: {
        currentStock: currentStock.toFixed(2),
        predictedStockOut: stockOutMonth,
        reorderQty: recommendedReorderQty.toFixed(2),
        avgConsumption: averageConsumption.toFixed(2),
      },
    };
  }, [selectedItemId, inventoryLogs]);

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">AI Forecast</h1>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Select Item to Forecast</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-10 w-full" /> : (
            <Select value={selectedItemId || ''} onValueChange={setSelectedItemId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an item from your BOQ" />
              </SelectTrigger>
              <SelectContent>
                {boqItems.map(item => (
                  <SelectItem key={item.id} value={item.id}>
                    {getItemDescription(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>
      
      {isLoading ? <Skeleton className="h-96 w-full" /> : selectedItemId && (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Card>
                    <CardHeader className="p-4 pb-2"><CardTitle className="text-sm font-medium">Current Stock</CardTitle></CardHeader>
                    <CardContent className="p-4 pt-0"><p className="text-xl font-bold">{forecastData.stats.currentStock}</p></CardContent>
                </Card>
                 <Card>
                    <CardHeader className="p-4 pb-2"><CardTitle className="text-sm font-medium">Avg. Monthly Usage</CardTitle></CardHeader>
                    <CardContent className="p-4 pt-0"><p className="text-xl font-bold">{forecastData.stats.avgConsumption}</p></CardContent>
                </Card>
                <Card>
                    <CardHeader className="p-4 pb-2"><CardTitle className="text-sm font-medium">Predicted Stock Out</CardTitle></CardHeader>
                    <CardContent className="p-4 pt-0"><p className="text-xl font-bold">{forecastData.stats.predictedStockOut}</p></CardContent>
                </Card>
                 <Card>
                    <CardHeader className="p-4 pb-2"><CardTitle className="text-sm font-medium">Reorder Quantity</CardTitle></CardHeader>
                    <CardContent className="p-4 pt-0"><p className="text-xl font-bold text-orange-600">{forecastData.stats.reorderQty}</p></CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                <CardTitle>Demand & Stock Forecasting</CardTitle>
                <CardDescription>Historical consumption vs. AI-predicted demand for the next 3 months.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={400}>
                        <AreaChart data={forecastData.chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorHistorical" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                                    <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorPredicted" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8}/>
                                    <stop offset="95%" stopColor="#82ca9d" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="month" />
                            <YAxis />
                            <CartesianGrid strokeDasharray="3 3" />
                            <Tooltip />
                            <Area type="monotone" dataKey="historical" stroke="#8884d8" fillOpacity={1} fill="url(#colorHistorical)" />
                            <Area type="monotone" dataKey="predicted" stroke="#82ca9d" fillOpacity={1} fill="url(#colorPredicted)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </>
      )}
    </div>
  );
}
