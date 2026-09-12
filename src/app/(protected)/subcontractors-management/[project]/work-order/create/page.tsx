'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  Trash2,
  Library,
  ChevronDown,
  ChevronRight,
  Component,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  query,
  where,
  serverTimestamp,
  getDoc,
  runTransaction,
} from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  WorkOrderItem as OriginalWorkOrderItem,
  SubItem,
  BoqItem,
  Subcontractor,
  Project,
  SerialNumberConfig,
  FabricationBomItem,
} from '@/lib/types';
import { BoqItemSelector } from '@/components/billing-recon/BoqItemSelector';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BoqMultiSelectDialog } from '@/components/billing-recon/BoqMultiSelectDialog';
import { Switch } from '@/components/ui/switch';
import { nanoid } from 'nanoid';
import { cn } from '@/lib/utils';
import { CustomAssemblyDialog } from '@/components/subcontractors-management/CustomAssemblyDialog';
import { projectMatchesSlug } from '@/lib/project-slug';
import { PM_TABLE_CLASS, PmContent, PmSectionHead, PmTopbar } from '@/components/project-management/pm-shell';

// UI-level WorkOrderItem — extends backend type with UI-only fields
type WorkOrderItem = Omit<OriginalWorkOrderItem, 'id' | 'subItems'> & {
  id: string;
  isBreakdown: boolean;
  subItems: (SubItem & { id: string })[];
  boqSlNo?: string;
};

const initialWorkOrderDetails = {
  workOrderNo: '',
  date: new Date().toISOString().split('T')[0],
  subcontractorId: '',
};

const initialSubItemState: Omit<SubItem, 'id'> = {
  slNo: '',
  name: '',
  unit: 'sqm',
  quantity: 0,
  rate: 0,
  totalAmount: 0,
};


export default function CreateWorkOrderPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const { project: projectSlug } = useParams() as { project: string };

  const [details, setDetails] = useState(initialWorkOrderDetails);
  const [items, setItems] = useState<WorkOrderItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isBoqMultiSelectOpen, setIsBoqMultiSelectOpen] = useState(false);
  const [isCustomAssemblyOpen, setIsCustomAssemblyOpen] = useState(false);
  const [previewWoNo, setPreviewWoNo] = useState('Generating...');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchData = async () => {
      if (!projectSlug) return;

      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const projectData = projectsSnapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as Project))
        .find(p => projectMatchesSlug(p.projectName, projectSlug));

      if (!projectData) {
        toast({ title: 'Project not found', variant: 'destructive' });
        return;
      }

      setCurrentProject(projectData);

      const subsSnap = await getDocs(
        query(collection(db, 'subcontractors'), where('status', '==', 'Active'))
      );
      setSubcontractors(
        subsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subcontractor))
      );

      const boqSnap = await getDocs(collection(db, 'projects', projectData.id, 'boqItems'));
      setBoqItems(boqSnap.docs.map(d => ({ id: d.id, ...d.data() } as BoqItem)));
    };

    fetchData();
  }, [projectSlug, toast]);

  useEffect(() => {
    const generatePreviewId = async () => {
      try {
        const configRef = doc(db, 'serialNumberConfigs', 'work-order');
        const configDoc = await getDoc(configRef);
        if (configDoc.exists()) {
          const configData = configDoc.data() as SerialNumberConfig;
          const newIndex = configData.startingIndex;
          const datePart = configData.format
            ? format(
                new Date(),
                configData.format
                  .replace(/y/g, 'y')
                  .replace(/m/g, 'M')
                  .replace(/d/g, 'd')
              )
            : '';
          const formattedIndex = String(newIndex).padStart(4, '0');
          const requestNo = `${configData.prefix || ''}${datePart}${formattedIndex}${
            configData.suffix || ''
          }`;
          setPreviewWoNo(requestNo);
        } else {
          setPreviewWoNo('Config not found');
        }
      } catch (error) {
        setPreviewWoNo('Error generating ID');
      }
    };

    generatePreviewId();
    if (items.length === 0) {
      addItem();
    }
  }, [projectSlug, items]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (
    index: number,
    field: keyof Omit<WorkOrderItem, 'id' | 'boqItemId' | 'description' | 'unit' | 'subItems'>,
    value: string | number | boolean
  ) => {
    const newItems = [...items];
    const item = newItems[index];

    if (field === 'isBreakdown') {
      item.isBreakdown = value as boolean;
      if (value && item.subItems.length === 0) {
        item.subItems = [{ ...initialSubItemState, id: nanoid() }];
      }
    } else if (field === 'orderQty' || field === 'rate') {
      (item[field] as number) = Number(value) || 0;
    } else {
      (item as any)[field] = value;
    }

    if (!item.isBreakdown) {
      item.totalAmount = (item.orderQty || 0) * (item.rate || 0);
    } else {
      const subItemsTotal = item.subItems.reduce(
        (sum, si) => sum + (si.totalAmount || 0),
        0
      );
      item.rate = subItemsTotal;
      item.totalAmount = subItemsTotal * (item.orderQty || 0);
    }

    newItems[index] = item;
    setItems(newItems);
  };

  const handleSubItemChange = (
    itemIndex: number,
    subIndex: number,
    field: keyof SubItem,
    value: string | number
  ) => {
    const newItems = [...items];
    const mainItem = newItems[itemIndex];
    const subItem = mainItem.subItems[subIndex];

    if (field === 'quantity' || field === 'rate') {
      (subItem[field] as number) = Number(value) || 0;
    } else {
      (subItem as any)[field] = value;
    }

    subItem.totalAmount = (subItem.quantity || 0) * (subItem.rate || 0);

    const subItemsTotal = mainItem.subItems.reduce(
      (sum, si) => sum + (si.totalAmount || 0),
      0
    );
    mainItem.rate = subItemsTotal;
    mainItem.totalAmount = subItemsTotal * (mainItem.orderQty || 0);

    setItems(newItems);
  };

  const addSubItem = (itemIndex: number) => {
    const newItems = [...items];
    newItems[itemIndex].subItems.push({ ...initialSubItemState, id: nanoid() });
    setItems(newItems);
  };

  const removeSubItem = (itemIndex: number, subItemId: string) => {
    const newItems = [...items];
    if (newItems[itemIndex].subItems.length > 1) {
      newItems[itemIndex].subItems = newItems[itemIndex].subItems.filter(
        si => si.id !== subItemId
      );

      const subItemsTotal = newItems[itemIndex].subItems.reduce(
        (sum, si) => sum + (si.totalAmount || 0),
        0
      );
      newItems[itemIndex].rate = subItemsTotal;
      newItems[itemIndex].totalAmount =
        subItemsTotal * (newItems[itemIndex].orderQty || 0);
      setItems(newItems);
    }
  };

  const addItem = () => {
    setItems(prev => [
      ...prev,
      {
        id: nanoid(),
        boqItemId: '',
        description: '',
        unit: '',
        orderQty: 0,
        rate: 0,
        totalAmount: 0,
        isBreakdown: false,
        subItems: [],
        boqSlNo: '',
      },
    ]);
  };

  const getItemDescription = (item: BoqItem | FabricationBomItem): string => {
    const descriptionKeys = [
      'Description',
      'DESCRIPTION OF ITEMS',
      'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)',
    ];
    for (const key of descriptionKeys) {
      if ((item as BoqItem)[key]) return String((item as BoqItem)[key]);
    }
    if ((item as FabricationBomItem).section) {
      return `${(item as FabricationBomItem).section}`;
    }
    const fallbackKey = Object.keys(item).find(k =>
      k.toLowerCase().includes('description')
    );
    return fallbackKey ? String((item as BoqItem)[fallbackKey]) : '';
  };

  const getSlNo = (item: BoqItem): string => {
    return String(item['Sl No'] || item['SL. No.'] || '');
  };

  const handleBoqItemSelect = (index: number, boqItem: BoqItem | null) => {
    if (!boqItem) return;
    const rateKey =
      Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) ||
      'rate';
    const newItems = [...items];

    newItems[index] = {
      ...newItems[index],
      boqItemId: boqItem.id,
      description: getItemDescription(boqItem),
      unit: String(boqItem.UNIT || boqItem.Unit || ''),
      rate: Number((boqItem as any)[rateKey] || 0),
      boqSlNo: String(boqItem['BOQ SL No'] || ''),
      isBreakdown: newItems[index].isBreakdown,
      subItems: newItems[index].subItems,
    };

    setItems(newItems);
  };

  const handleAddFromBoq = (selectedItems: BoqItem[]) => {
    const newWorkOrderItems: WorkOrderItem[] = selectedItems.map(boqItem => {
      const rateKey =
        Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) ||
        'rate';
      return {
        id: nanoid(),
        boqItemId: boqItem.id,
        description: getItemDescription(boqItem),
        unit: String(boqItem.UNIT || boqItem.Unit || ''),
        orderQty: 0,
        rate: Number((boqItem as any)[rateKey] || 0),
        totalAmount: 0,
        boqSlNo: String(boqItem['BOQ SL No'] || ''),
        isBreakdown: false,
        subItems: [],
      };
    });

    const isFirstItemEmpty = items.length === 1 && !items[0].boqItemId;
    if (isFirstItemEmpty) {
      setItems(newWorkOrderItems);
    } else {
      setItems(prev => [...prev, ...newWorkOrderItems]);
    }
  };

  // 🔧 FIXED: use OriginalWorkOrderItem here so it matches CustomAssemblyDialog's prop type
  const handleAddCustomAssembly = (assembly: {
    mainItem: Omit<OriginalWorkOrderItem, 'id'>;
    bom: BoqItem[];
  }) => {
    const newMainItem: WorkOrderItem = {
      ...assembly.mainItem,
      id: nanoid(),
      isBreakdown: true,
      subItems: assembly.bom.map(boqItem => {
        const rateKey = Object.keys(boqItem).find(k =>
          k.toLowerCase().includes('rate')
        ) || 'rate';
        const rate = Number((boqItem as any)[rateKey] || 0);
        return {
          id: nanoid(),
          slNo: String(boqItem['BOQ SL No'] || ''),
          name: getItemDescription(boqItem),
          unit: String(boqItem.UNIT || boqItem.Unit || ''),
          quantity: 0, // user can edit later
          rate,
          totalAmount: rate * 0,
        };
      }),
    };

    // derive rate & total from sub-items
    newMainItem.rate = newMainItem.subItems.reduce(
      (sum, si) => sum + (si.totalAmount || 0),
      0
    );
    newMainItem.totalAmount = newMainItem.rate * (newMainItem.orderQty || 0);

    const isFirstItemEmpty = items.length === 1 && !items[0].boqItemId;
    if (isFirstItemEmpty) {
      setItems([newMainItem]);
    } else {
      setItems(prev => [...prev, newMainItem]);
    }
  };

  const removeItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const toggleRowExpansion = (itemId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) newSet.delete(itemId);
      else newSet.add(itemId);
      return newSet;
    });
  };

  const handleSave = async () => {
    if (!user || !currentProject || !details.subcontractorId || items.length === 0) {
      toast({
        title: 'Missing Fields',
        description: 'Please select a subcontractor and add at least one item.',
        variant: 'destructive',
      });
      return;
    }
    setIsSaving(true);

    try {
      const configDocRef = doc(db, 'serialNumberConfigs', 'work-order');

      await runTransaction(db, async transaction => {
        const configDoc = await transaction.get(configDocRef);
        if (!configDoc.exists())
          throw new Error('Work Order serial number configuration not found!');
        const config = configDoc.data() as SerialNumberConfig;
        const newIndex = config.startingIndex;
        const datePart = config.format
          ? format(
              new Date(),
              config.format
                .replace(/y/g, 'y')
                .replace(/m/g, 'M')
                .replace(/d/g, 'd')
            )
          : '';
        const workOrderNo = `${config.prefix || ''}${datePart}${String(
          newIndex
        ).padStart(4, '0')}${config.suffix || ''}`;

        transaction.update(configDocRef, { startingIndex: newIndex + 1 });

        const subcontractorName =
          subcontractors.find(s => s.id === details.subcontractorId)?.legalName ||
          'Unknown';
        const totalAmount = items.reduce(
          (sum, item) => sum + (item.totalAmount || 0),
          0
        );

        const woCollectionRef = collection(
          db,
          'projects',
          currentProject.id,
          'workOrders'
        );
        const newWoRef = doc(woCollectionRef);

        const itemsToSave = items.map(item => {
          const { id, isBreakdown, subItems, ...rest } = item;
          return {
            ...rest,
            id: nanoid(),
            totalAmount: item.totalAmount,
            subItems: item.isBreakdown
              ? item.subItems.map(({ id: subId, ...subRest }) => ({
                  ...subRest,
                  id: nanoid(),
                }))
              : [],
          };
        });

        const workOrderData = {
          ...details,
          workOrderNo,
          projectId: currentProject.id,
          subcontractorName,
          totalAmount,
          items: itemsToSave,
          createdAt: serverTimestamp(),
          createdBy: user.id,
        };

        transaction.set(newWoRef, workOrderData);
      });

      toast({
        title: 'Work Order Created',
        description: `Successfully created the work order.`,
      });
      router.push(`/subcontractors-management/${projectSlug}/work-order`);
    } catch (error: any) {
      console.error('Error creating work order:', error);
      toast({
        title: 'Save Failed',
        description: error.message || 'Could not create work order.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);

  return (
    <>
      <PmTopbar
        title="Create Work Order"
        breadcrumbs={[
          { label: 'Subcontractors', href: `/subcontractors-management/${projectSlug}` },
          { label: 'Work Orders', href: `/subcontractors-management/${projectSlug}/work-order` },
        ]}
        backHref={`/subcontractors-management/${projectSlug}/work-order`}
        backLabel="Back to Work Orders"
        actions={
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Save Work Order
          </Button>
        }
      />
      <PmContent>
        {/* Who and when — one compact panel, matching the meta strip on the Project Management
            document forms rather than a full Card header for three fields. */}
        <div className="mb-4 grid gap-3 rounded-lg border border-border/60 bg-muted/30 p-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="workOrderNo" className="text-xs">
              Work Order No.
            </Label>
            <Input
              id="workOrderNo"
              value={previewWoNo}
              readOnly
              className="h-9 bg-background font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date" className="text-xs">
              Date
            </Label>
            <Input
              id="date"
              name="date"
              type="date"
              className="h-9 bg-background"
              value={details.date}
              onChange={handleDetailChange}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subcontractor" className="text-xs">
              Subcontractor
            </Label>
            <Select
              value={details.subcontractorId}
              onValueChange={value =>
                setDetails(prev => ({ ...prev, subcontractorId: value }))
              }
            >
              <SelectTrigger id="subcontractor" className="h-9 bg-background">
                <SelectValue placeholder="Select a subcontractor" />
              </SelectTrigger>
              <SelectContent>
                {subcontractors.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.legalName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <PmSectionHead
          title="Work order items"
          stats={[
            { label: items.length === 1 ? 'line' : 'lines', value: String(items.length) },
            {
              label: 'order value',
              value: formatCurrency(items.reduce((sum, item) => sum + (item.totalAmount || 0), 0)),
            },
          ]}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setIsBoqMultiSelectOpen(true)}
              >
                <Library className="mr-1.5 h-4 w-4" /> Add From BOQ
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setIsCustomAssemblyOpen(true)}
              >
                <Component className="mr-1.5 h-4 w-4" /> Add Custom Assembly
              </Button>
            </>
          }
        />
        <Card className="border-border/60">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className={PM_TABLE_CLASS}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12" />
                    <TableHead>BOQ Sl.No</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>BOQ Qty</TableHead>
                    <TableHead>BOQ Rate</TableHead>
                    <TableHead>Break Down</TableHead>
                    <TableHead>Order Qty</TableHead>
                    <TableHead>Order Rate</TableHead>
                    <TableHead>Total Amount</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => {
                    const boqItem = boqItems.find(b => b.id === item.boqItemId);
                    const rateKey =
                      boqItem &&
                      (Object.keys(boqItem).find(key =>
                        key.toLowerCase().includes('rate')
                      ) ||
                        'rate');
                    const boqRate =
                      boqItem && rateKey ? (boqItem as any)[rateKey] : 0;
                    const isExpanded = expandedRows.has(item.id);

                    return (
                      <Fragment key={item.id}>
                        <TableRow>
                          <TableCell>
                            {item.isBreakdown && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => toggleRowExpansion(item.id)}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </TableCell>
                          <TableCell className="w-48">
                            <BoqItemSelector
                              boqItems={boqItems}
                              selectedSlNo={item.boqSlNo || null}
                              onSelect={selectedBoqItem =>
                                handleBoqItemSelect(index, selectedBoqItem)
                              }
                              isLoading={false}
                            />
                          </TableCell>
                          <TableCell>
                            <p className="line-clamp-2" title={item.description}>
                              {item.description}
                            </p>
                          </TableCell>
                          <TableCell>{item.unit}</TableCell>
                          <TableCell>
                            {boqItem ? (boqItem as any).QTY || 0 : 'N/A'}
                          </TableCell>
                          <TableCell>{formatCurrency(boqRate)}</TableCell>
                          <TableCell>
                            <Switch
                              checked={item.isBreakdown}
                              onCheckedChange={checked =>
                                handleItemChange(index, 'isBreakdown', checked)
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={item.orderQty}
                              onChange={e =>
                                handleItemChange(
                                  index,
                                  'orderQty',
                                  e.target.value
                                )
                              }
                              className={cn('min-w-[100px]')}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={item.rate}
                              onChange={e =>
                                handleItemChange(index, 'rate', e.target.value)
                              }
                              className={cn(
                                'min-w-[120px]',
                                item.isBreakdown && 'bg-muted line-through'
                              )}
                              readOnly={item.isBreakdown}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={formatCurrency(item.totalAmount)}
                              readOnly
                              className="min-w-[150px] bg-muted"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(item.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>

                        {isExpanded && item.isBreakdown && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={11} className="p-0">
                              <div className="space-y-2 p-4">
                                <h4 className="text-sm font-semibold">
                                  Sub-Items (per 1 set of Main Item)
                                </h4>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Sl. No.</TableHead>
                                      <TableHead>Name</TableHead>
                                      <TableHead>Unit</TableHead>
                                      <TableHead>Qty/Set</TableHead>
                                      <TableHead>Rate</TableHead>
                                      <TableHead>Total Amount</TableHead>
                                      <TableHead />
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {item.subItems.map((sub, subIndex) => (
                                      <TableRow key={sub.id}>
                                        <TableCell>
                                          <Input
                                            placeholder="Sl.No."
                                            value={sub.slNo}
                                            onChange={e =>
                                              handleSubItemChange(
                                                index,
                                                subIndex,
                                                'slNo',
                                                e.target.value
                                              )
                                            }
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Input
                                            placeholder="Name"
                                            value={sub.name}
                                            onChange={e =>
                                              handleSubItemChange(
                                                index,
                                                subIndex,
                                                'name',
                                                e.target.value
                                              )
                                            }
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Input
                                            placeholder="Unit"
                                            value={sub.unit}
                                            onChange={e =>
                                              handleSubItemChange(
                                                index,
                                                subIndex,
                                                'unit',
                                                e.target.value
                                              )
                                            }
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Input
                                            type="number"
                                            placeholder="Qty/Set"
                                            value={sub.quantity}
                                            onChange={e =>
                                              handleSubItemChange(
                                                index,
                                                subIndex,
                                                'quantity',
                                                e.target.value
                                              )
                                            }
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Input
                                            type="number"
                                            placeholder="Rate"
                                            value={sub.rate}
                                            onChange={e =>
                                              handleSubItemChange(
                                                index,
                                                subIndex,
                                                'rate',
                                                e.target.value
                                              )
                                            }
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Input
                                            value={formatCurrency(
                                              sub.totalAmount
                                            )}
                                            readOnly
                                            className="bg-background/50"
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() =>
                                              removeSubItem(index, sub.id)
                                            }
                                          >
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => addSubItem(index)}
                                >
                                  <Plus className="mr-2 h-4 w-4" /> Add Sub-Item
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {/* CardContent is p-0 so the table meets the card edges; the footer supplies its own. */}
            <div className="border-t border-border/60 p-3">
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus className="mr-1.5 h-4 w-4" /> Add Item
              </Button>
            </div>
          </CardContent>
        </Card>
      </PmContent>

      <BoqMultiSelectDialog
        isOpen={isBoqMultiSelectOpen}
        onOpenChange={setIsBoqMultiSelectOpen}
        boqItems={boqItems}
        onConfirm={handleAddFromBoq}
        alreadyAddedItems={items as any}
      />

      <CustomAssemblyDialog
        isOpen={isCustomAssemblyOpen}
        onOpenChange={setIsCustomAssemblyOpen}
        boqItems={boqItems}
        onConfirm={handleAddCustomAssembly}
      />
    </>
  );
}
