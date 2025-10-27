
'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PlusCircle, Search, ChevronDown, ChevronRight, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { BoqItem, Project, FabricationBomItem } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { BomDialog } from '@/components/BomDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export default function AssemblyPage() {
  const params = useParams();
  const projectSlug = params.project as string;
  const { toast } = useToast();
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<BoqItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterColumn, setFilterColumn] = useState('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [sortKey, setSortKey] = useState<string>('erpSlNo');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');


  const fetchBoqItems = async () => {
    if (!projectSlug) return;
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

        const boqQuery = query(collection(db, 'projects', projectData.id, 'boqItems'));
        const boqSnapshot = await getDocs(boqQuery);
        const items = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
        setBoqItems(items);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch BOQ items.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBoqItems();
  }, [projectSlug]);

  const handleOpenDialog = (item: BoqItem) => {
    setSelectedItem(item);
    setIsDialogOpen(true);
  };
  
  const toggleRowExpansion = (itemId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    if ('Unit Rate' in item) return 'Unit Rate';
    if ('UNIT PRICE' in item) return 'UNIT PRICE';
    return keys.find(key => key.toLowerCase().includes('rate') && !key.toLowerCase().includes('total'));
  };

  const getItemDescription = (item: BoqItem) => {
    const descriptionKeys = [
      'Description',
      'DESCRIPTION OF ITEMS',
      'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'
    ];
    for (const key of descriptionKeys) {
      if (item[key]) return String(item[key]);
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? String(item[fallbackKey]) : '';
  };
  
  const getSlNo = (item: BoqItem): string => {
    return String(item['BOQ SL No'] || item['SL. No.'] || '');
  }

  const getErpSlNo = (item: BoqItem): string => {
    return String(item['ERP SL NO'] || '');
  }
  
  const formatCurrency = (value: any) => {
    const num = parseFloat(value);
    if(isNaN(num)) return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }

  const getBoqQty = (item: BoqItem): string => {
    return String(item['QTY'] || item['Total Qty'] || '0');
  }

  const getUnit = (item: BoqItem): string => {
    return String(item['Unit'] || item['UNIT'] || 'N/A');
  }

  const handleSort = (key: string) => {
    if (sortKey === key) {
        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
        setSortKey(key);
        setSortDirection('asc');
    }
  };

  const sortedAndFilteredBoqItems = useMemo(() => {
    let itemsToProcess = [...boqItems];

    if (searchTerm) {
        const lowercasedFilter = searchTerm.toLowerCase();
        itemsToProcess = itemsToProcess.filter(item => {
            const description = getItemDescription(item).toLowerCase();
            const slNo = getSlNo(item).toLowerCase();
            const erpSlNo = getErpSlNo(item).toLowerCase();

            if (filterColumn === 'all') {
                return description.includes(lowercasedFilter) || slNo.includes(lowercasedFilter) || erpSlNo.includes(lowercasedFilter);
            }
            if (filterColumn === 'boqSlNo') return slNo.includes(lowercasedFilter);
            if (filterColumn === 'erpSlNo') return erpSlNo.includes(lowercasedFilter);
            if (filterColumn === 'description') return description.includes(lowercasedFilter);
            return true;
        });
    }

    if (sortKey) {
        itemsToProcess.sort((a, b) => {
            const valA = a[sortKey] ?? getSlNo(a); // Fallback for complex keys
            const valB = b[sortKey] ?? getSlNo(b);
            
            const numA = parseFloat(String(valA));
            const numB = parseFloat(String(valB));

            if (!isNaN(numA) && !isNaN(numB)) {
                return sortDirection === 'asc' ? numA - numB : numB - numA;
            }

            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();

            return sortDirection === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
        });
    }
    
    return itemsToProcess;
  }, [boqItems, searchTerm, filterColumn, sortKey, sortDirection]);

  return (
    <>
      <div>
        <h1 className="text-3xl font-bold mb-6">BOM Management</h1>
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>BOQ Items</CardTitle>
              <div className="flex items-center gap-2">
                <Select value={filterColumn} onValueChange={setFilterColumn}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filter by..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Columns</SelectItem>
                    <SelectItem value="erpSlNo">ERP SL No.</SelectItem>
                    <SelectItem value="boqSlNo">BOQ Sl. No.</SelectItem>
                    <SelectItem value="description">Description</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[calc(100vh-22rem)]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>
                      <Button variant="ghost" onClick={() => handleSort('ERP SL NO')} className="px-0">
                        ERP SL No.
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>
                       <Button variant="ghost" onClick={() => handleSort('BOQ SL No')} className="px-0">
                         BOQ Sl. No.
                         <ArrowUpDown className="ml-2 h-4 w-4" />
                       </Button>
                    </TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>BOQ Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Unit Price</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={8}><Skeleton className="h-6 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : sortedAndFilteredBoqItems.length > 0 ? (
                    sortedAndFilteredBoqItems.map(item => {
                        const rateKey = findBasicPriceKey(item);
                        const rate = rateKey ? item[rateKey] : '0';
                        const hasBom = item.bom && item.bom.length > 0;
                        const isExpanded = expandedRows.has(item.id);
                        return (
                          <Fragment key={item.id}>
                            <TableRow>
                              <TableCell>
                                {hasBom && (
                                  <Button size="icon" variant="ghost" onClick={() => toggleRowExpansion(item.id)}>
                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell>{getErpSlNo(item)}</TableCell>
                              <TableCell>{getSlNo(item)}</TableCell>
                              <TableCell>{getItemDescription(item)}</TableCell>
                              <TableCell>{getBoqQty(item)}</TableCell>
                              <TableCell>{getUnit(item)}</TableCell>
                              <TableCell>{formatCurrency(rate)}</TableCell>
                              <TableCell className="text-right">
                                <Button variant="outline" size="sm" onClick={() => handleOpenDialog(item)}>
                                  <PlusCircle className="mr-2 h-4 w-4" />
                                  {hasBom ? 'Edit' : 'Add'} BOM
                                </Button>
                              </TableCell>
                            </TableRow>
                            {isExpanded && hasBom && (
                               <TableRow className="bg-muted/50 hover:bg-muted/50">
                                    <TableCell colSpan={8} className="p-0">
                                      <div className="p-4">
                                        <h4 className="font-semibold mb-2 ml-2">Bill of Materials</h4>
                                        <Table>
                                          <TableHeader>
                                            <TableRow>
                                              <TableHead>Mark No.</TableHead>
                                              <TableHead>Section</TableHead>
                                              <TableHead>Grade</TableHead>
                                              <TableHead>Length</TableHead>
                                              <TableHead>Wt/Pc (KG)</TableHead>
                                              <TableHead>Qty/Set</TableHead>
                                              <TableHead>Total Wt (KG)</TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {item.bom!.map((bomItem, index) => (
                                              <TableRow key={index}>
                                                <TableCell>{bomItem.markNo}</TableCell>
                                                <TableCell>{bomItem.section}</TableCell>
                                                <TableCell>{bomItem.grade}</TableCell>
                                                <TableCell>{bomItem.length}</TableCell>
                                                <TableCell>{bomItem.wtPerPc?.toFixed(3)}</TableCell>
                                                <TableCell>{bomItem.qtyPerSet}</TableCell>
                                                <TableCell>{bomItem.totalWtKg?.toFixed(3)}</TableCell>
                                              </TableRow>
                                            ))}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    </TableCell>
                               </TableRow>
                            )}
                          </Fragment>
                        )
                    })
                  ) : (
                     <TableRow>
                        <TableCell colSpan={8} className="text-center h-24">No BOQ Items found for this project.</TableCell>
                     </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
      {selectedItem && (
        <BomDialog
          isOpen={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          mainItem={selectedItem}
          onSaveSuccess={fetchBoqItems}
        />
      )}
    </>
  );
}
