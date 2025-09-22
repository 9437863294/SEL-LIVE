
'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import type { ProjectInsurancePolicy, ProjectPolicyRenewal } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';


interface EnrichedPolicy extends ProjectInsurancePolicy {
  history: ProjectPolicyRenewal[];
}

export default function AllProjectPoliciesPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [policies, setPolicies] = useState<EnrichedPolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState({
    search: '',
    assetName: 'all',
    insuranceCompany: 'all',
    policyCategory: 'all',
  });

  const canViewPage = can('View', 'Insurance.Project Insurance');

  useEffect(() => {
    if (isAuthLoading) return;
    if (canViewPage) {
      fetchPolicies();
    } else {
      setIsLoading(false);
    }
  }, [isAuthLoading, canViewPage]);

  const fetchPolicies = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'project_insurance_policies'), orderBy('insurance_start_date', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const policiesDataPromises = querySnapshot.docs.map(async (doc) => {
        const policy = { id: doc.id, ...doc.data() } as ProjectInsurancePolicy;
        const historySnapshot = await getDocs(collection(db, 'project_insurance_policies', doc.id, 'history'));
        const history = historySnapshot.docs.map(hDoc => ({ id: hDoc.id, ...hDoc.data() } as ProjectPolicyRenewal));
        history.sort((a,b) => b.renewalDate.toMillis() - a.renewalDate.toMillis());
        return { ...policy, history };
      });
      
      const policiesData = await Promise.all(policiesDataPromises);
      setPolicies(policiesData);

    } catch (error) {
      console.error("Error fetching all policies:", error);
      toast({ title: 'Error', description: 'Failed to fetch policies.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  const handleRowClick = (assetId: string, event: React.MouseEvent) => {
    // Navigate only if the click is not on the expansion toggle
    const target = event.target as HTMLElement;
    if (!target.closest('[data-toggle-row]')) {
        router.push(`/insurance/project/${assetId}`);
    }
  };

  const toggleRowExpansion = (policyId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(policyId)) {
        newSet.delete(policyId);
      } else {
        newSet.add(policyId);
      }
      return newSet;
    });
  };

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return format(d, 'dd-MMM-yy');
  };

  const formatCurrency = (amount: number) => {
    if (typeof amount !== 'number') return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
      setFilters(prev => ({...prev, [key]: value}));
  };

  const filteredPolicies = useMemo(() => {
    return policies.filter(policy => {
        const searchMatch = filters.search === '' || policy.policy_no.toLowerCase().includes(filters.search.toLowerCase());
        const assetMatch = filters.assetName === 'all' || policy.assetName === filters.assetName;
        const companyMatch = filters.insuranceCompany === 'all' || policy.insurance_company === filters.insuranceCompany;
        const categoryMatch = filters.policyCategory === 'all' || policy.policy_category === filters.policyCategory;

        return searchMatch && assetMatch && companyMatch && categoryMatch;
    });
  }, [policies, filters]);

  const filterOptions = useMemo(() => {
    const assetNames = [...new Set(policies.map(p => p.assetName))];
    const companies = [...new Set(policies.map(p => p.insurance_company))];
    const categories = [...new Set(policies.map(p => p.policy_category))];
    return { assetNames, companies, categories };
  }, [policies]);
  
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-96 w-full" />
        </div>
    );
  }

  if (!canViewPage) {
     return (
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold">All Project Policies</h1>
                </div>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view project insurance policies.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
            </Card>
        </div>
    );
  }


  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
           <Link href="/insurance/project">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">All Project Policies</h1>
              <p className="text-sm text-muted-foreground">A consolidated list of all project-related insurance policies.</p>
            </div>
        </div>
      </div>

       <Card className="mb-6">
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search Policy No..." className="pl-8" value={filters.search} onChange={(e) => handleFilterChange('search', e.target.value)} />
            </div>
            <Select value={filters.assetName} onValueChange={(v) => handleFilterChange('assetName', v)}>
                <SelectTrigger><SelectValue placeholder="Filter by Asset..." /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Assets</SelectItem>
                    {filterOptions.assetNames.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
            </Select>
             <Select value={filters.insuranceCompany} onValueChange={(v) => handleFilterChange('insuranceCompany', v)}>
                <SelectTrigger><SelectValue placeholder="Filter by Company..." /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Companies</SelectItem>
                    {filterOptions.companies.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
            </Select>
             <Select value={filters.policyCategory} onValueChange={(v) => handleFilterChange('policyCategory', v)}>
                <SelectTrigger><SelectValue placeholder="Filter by Category..." /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {filterOptions.categories.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
            </Select>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Asset Name</TableHead>
                <TableHead>Policy Category</TableHead>
                <TableHead>Policy No.</TableHead>
                <TableHead>Insurance Company</TableHead>
                <TableHead>Premium</TableHead>
                <TableHead>Sum Insured</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>Insured Until</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : filteredPolicies.length > 0 ? (
                filteredPolicies.map(policy => (
                  <Fragment key={policy.id}>
                    <TableRow onClick={(e) => handleRowClick(policy.assetId, e)} className="cursor-pointer">
                        <TableCell className="px-2">
                           <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); toggleRowExpansion(policy.id); }} data-toggle-row>
                             {expandedRows.has(policy.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                           </Button>
                        </TableCell>
                        <TableCell className="font-medium">{policy.assetName}</TableCell>
                        <TableCell>{policy.policy_category}</TableCell>
                        <TableCell>{policy.policy_no}</TableCell>
                        <TableCell>{policy.insurance_company}</TableCell>
                        <TableCell>{formatCurrency(policy.premium)}</TableCell>
                        <TableCell>{formatCurrency(policy.sum_insured)}</TableCell>
                        <TableCell>{formatDate(policy.insurance_start_date)}</TableCell>
                        <TableCell>{formatDate(policy.insured_until)}</TableCell>
                    </TableRow>
                    {expandedRows.has(policy.id) && (
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={9} className="p-0">
                            <div className="p-4">
                                <h4 className="font-semibold mb-2 ml-2">Renewal History</h4>
                                {policy.history && policy.history.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Renewal Date</TableHead>
                                                <TableHead>Old Policy No.</TableHead>
                                                <TableHead>Old Premium</TableHead>
                                                <TableHead>Old Sum Insured</TableHead>
                                                <TableHead>Old Period</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {policy.history.map(h => (
                                                <TableRow key={h.id}>
                                                    <TableCell>{formatDate(h.renewalDate)}</TableCell>
                                                    <TableCell>{h.policyNo}</TableCell>
                                                    <TableCell>{formatCurrency(h.premium)}</TableCell>
                                                    <TableCell>{formatCurrency(h.sumInsured)}</TableCell>
                                                    <TableCell>{formatDate(h.startDate)} - {formatDate(h.endDate)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="text-sm text-muted-foreground p-4 text-center">No renewal history for this policy.</p>
                                )}
                            </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))
              ) : (
                 <TableRow>
                    <TableCell colSpan={9} className="text-center h-24">
                        No insurance policies found for the selected filters.
                    </TableCell>
                 </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
