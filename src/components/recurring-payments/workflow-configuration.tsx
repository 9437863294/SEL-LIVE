'use client';

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { GripVertical, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { User } from '@/lib/types';
import { personOptionLabel } from '@/lib/people-directory';
import { withDesignations } from '@/lib/people-directory-client';
import { DEFAULT_RECURRING_WORKFLOW, isOpenObligation, RP_COLLECTIONS, type PaymentObligation, RecurringAmountAssignee, RecurringWorkflowStep } from '@/lib/recurring-payments';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuthorization } from '@/hooks/useAuthorization';

const ACTIONS = ['Submit Bill','Verify','Approve','Record Payment','Close','Return for Correction','Reject','Dispute','On Hold','Payment Failed','Create Expense Request'];

export default function RecurringWorkflowConfiguration() {
  const { toast }=useToast();
  const { can }=useAuthorization();
  const { user }=useAuth();
  const organizationId=user?.organizationId||'default';
  const canEdit=can('Edit Workflow','Recurring Payments.Settings');
  const [steps,setSteps]=useState<RecurringWorkflowStep[]>([]);
  const [users,setUsers]=useState<User[]>([]);
  const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false);
  // A failed load leaves `steps` empty; saving that would write `steps: []` over the live workflow,
  // so a failed load disables Save instead. `savedSteps` is what the live workflow holds — used to
  // spot steps removed in this edit that open payments still sit on.
  const [loadFailed,setLoadFailed]=useState(false); const [savedSteps,setSavedSteps]=useState<{id:string;name:string}[]>([]);
  useEffect(()=>{(async()=>{try{const [workflowSnap,userSnap]=await Promise.all([getDoc(doc(db,'workflows','recurring-payments-workflow')),getDocs(collection(db,'users'))]);const loaded:RecurringWorkflowStep[]=workflowSnap.exists()&&workflowSnap.data().steps?.length?workflowSnap.data().steps:DEFAULT_RECURRING_WORKFLOW;setSteps(loaded);setSavedSteps(loaded.map(({id,name})=>({id,name})));setUsers(await withDesignations(userSnap.docs.map(d=>({id:d.id,...d.data()} as User)).filter(u=>u.status!=='Inactive')));}catch{setLoadFailed(true);toast({title:'Workflow could not be loaded',description:'Saving is disabled so the live workflow is not overwritten. Reload the page to try again.',variant:'destructive'});}finally{setLoading(false)}})()},[toast]);

  const update=(id:string,patch:Partial<RecurringWorkflowStep>)=>setSteps(current=>current.map(step=>step.id===id?{...step,...patch}:step));
  const addStep=()=>setSteps(current=>[...current,{id:crypto.randomUUID(),name:`New Step ${current.length+1}`,description:'',tat:8,assignmentType:'User-based',assignedTo:[],actions:['Approve'],uploadRequired:false}]);
  // Step ids are stable identifiers persisted on live payment obligations (currentStepId,
  // workflowHistory, documentReferences) — never renumber/reassign them on delete or save,
  // or in-flight payments sitting at a later step would silently be reinterpreted as whatever
  // step now occupies that id.
  const removeStep=(id:string)=>setSteps(current=>current.filter(step=>step.id!==id));
  const toggleAction=(step:RecurringWorkflowStep,action:string,checked:boolean)=>update(step.id,{actions:checked?[...new Set([...step.actions,action])]:step.actions.filter(x=>x!==action)});
  async function save(){if(loadFailed)return toast({title:'The workflow did not load, so it cannot be saved',description:'Reload the page and try again.',variant:'destructive'});if(!steps.length)return toast({title:'The workflow needs at least one step',variant:'destructive'});for(const step of steps){if(!step.name.trim())return toast({title:'Every step needs a name',variant:'destructive'});if(step.assignmentType==='User-based'&&!(step.assignedTo as string[])[0])return toast({title:`Assign a user to ${step.name}`,variant:'destructive'});if(step.assignmentType==='Amount-based'&&!(step.assignedTo as RecurringAmountAssignee[]).some(x=>x.userId))return toast({title:`Add an amount assignee to ${step.name}`,variant:'destructive'});const rangeIssue=step.assignmentType==='Amount-based'?amountRangeProblem(step.assignedTo as RecurringAmountAssignee[]):null;if(rangeIssue)return toast({title:`${step.name}: ${rangeIssue}`,variant:'destructive'});if(!step.actions.length)return toast({title:`Select at least one action for ${step.name}`,variant:'destructive'});}setSaving(true);try{
    // A step deleted while open payments sit on it would strand them on a step that no longer exists.
    const removed=savedSteps.filter(saved=>!steps.some(step=>step.id===saved.id));
    if(removed.length){const snapshot=await getDocs(query(collection(db,RP_COLLECTIONS.payments),where('organizationId','==',organizationId)));const stranded=snapshot.docs.map(d=>d.data() as PaymentObligation).filter(p=>p.deleted!==true&&p.currentStepId&&removed.some(step=>step.id===p.currentStepId)&&isOpenObligation(p));if(stranded.length){const counts=removed.map(step=>({name:step.name,count:stranded.filter(p=>p.currentStepId===step.id).length})).filter(x=>x.count);return toast({title:'Open payments are still on a removed step',description:`${counts.map(x=>`${x.count} on "${x.name}"`).join(', ')}. Move or close them before removing the step.`,variant:'destructive'});}}
    await setDoc(doc(db,'workflows','recurring-payments-workflow'),{module:'Recurring Payments',steps,updatedAt:serverTimestamp()});setSavedSteps(steps.map(({id,name})=>({id,name})));toast({title:'Recurring payment workflow saved'});}catch{toast({title:'Workflow could not be saved',variant:'destructive'});}finally{setSaving(false)}}
  if(loading)return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin"/></div>;
  return <div className="space-y-5"><PageHeader backHref="/recurring-payments/settings" backLabel="Back to settings" title="Workflow Configuration" description="Each step automatically creates its own assigned-person work queue." actions={<><Button variant="outline" onClick={addStep} disabled={!canEdit}><Plus className="mr-2 h-4 w-4"/>Add step</Button><Button onClick={save} disabled={saving||!canEdit||loadFailed||!steps.length}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Save workflow</Button></>}/>
    <div className="space-y-4">{steps.map((step,index)=><Card key={step.id}><CardHeader className="flex flex-row items-start gap-3"><div className="mt-1 rounded-lg bg-indigo-100 p-2 text-indigo-700"><GripVertical className="h-4 w-4"/></div><div className="flex-1"><CardTitle>Step {index+1}: {step.name}</CardTitle><CardDescription>{index===0?'Activated automatically at the configured number of days before due date.':'Entered when the previous step completes.'}</CardDescription></div>{steps.length>1&&<Button variant="ghost" size="icon" className="text-destructive" onClick={()=>removeStep(step.id)}><Trash2 className="h-4 w-4"/></Button>}</CardHeader><CardContent className="grid gap-5 md:grid-cols-2">
      <div className="space-y-4"><Field label="Step name"><Input value={step.name} onChange={e=>update(step.id,{name:e.target.value})}/></Field><Field label="Instructions"><Textarea value={step.description} onChange={e=>update(step.id,{description:e.target.value})}/></Field><div className="grid grid-cols-2 gap-3"><Field label="TAT (hours)"><Input type="number" min="1" value={step.tat} onChange={e=>update(step.id,{tat:Math.max(1,Number(e.target.value))})}/></Field><Field label="Assignment"><Select value={step.assignmentType} onValueChange={(assignmentType:RecurringWorkflowStep['assignmentType'])=>update(step.id,{assignmentType,assignedTo:[]})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="Payment-owner">Payment owner</SelectItem><SelectItem value="User-based">Selected users</SelectItem><SelectItem value="Amount-based">Amount ranges</SelectItem></SelectContent></Select></Field></div><div className="flex items-center justify-between rounded-lg border p-3"><Label>Supporting document required</Label><Checkbox checked={step.uploadRequired} onCheckedChange={checked=>update(step.id,{uploadRequired:checked===true})}/></div></div>
      <div className="space-y-4"><AssignmentEditor step={step} users={users} onChange={assignedTo=>update(step.id,{assignedTo})}/><Field label="Allowed actions"><div className="grid grid-cols-2 gap-2">{ACTIONS.map(action=><label key={action} className="flex items-center gap-2 rounded-lg border p-2 text-sm"><Checkbox checked={step.actions.includes(action)} onCheckedChange={v=>toggleAction(step,action,v===true)}/>{action}</label>)}</div></Field></div>
    </CardContent></Card>)}</div>
  </div>;
}

/** Every range needs a user and a min no greater than its max; ranges may share an endpoint but not overlap. */
function amountRangeProblem(ranges:RecurringAmountAssignee[]):string|null{const ceiling=(r:RecurringAmountAssignee)=>r.maxAmount==null?Number.POSITIVE_INFINITY:Number(r.maxAmount);for(const r of ranges){if(!r.userId)return 'every amount range needs a user';if(Number(r.minAmount||0)<0)return 'amounts cannot be negative';if(Number(r.minAmount||0)>ceiling(r))return 'a range has its minimum above its maximum';}for(let i=0;i<ranges.length;i++)for(let j=i+1;j<ranges.length;j++){const a=ranges[i],b=ranges[j];if(Number(a.minAmount||0)<ceiling(b)&&Number(b.minAmount||0)<ceiling(a))return 'amount ranges overlap — each amount should have one assignee';}return null;}
function AssignmentEditor({step,users,onChange}:{step:RecurringWorkflowStep;users:User[];onChange:(value:string[]|RecurringAmountAssignee[])=>void}){
  if(step.assignmentType==='Payment-owner')return <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">The assigned employee from the recurring master receives this step.</div>;
  if(step.assignmentType==='User-based'){const assigned=step.assignedTo as string[];return <div className="space-y-3"><Field label="Primary assignee"><UserSelect users={users} value={assigned[0]||''} onChange={value=>onChange([value,assigned[1]||''].filter(Boolean))}/></Field><Field label="Alternative assignee"><UserSelect users={users} value={assigned[1]||''} allowNone onChange={value=>onChange([assigned[0]||'',value].filter(Boolean))}/></Field></div>}
  const ranges=step.assignedTo as RecurringAmountAssignee[];
  const change=(id:string,patch:Partial<RecurringAmountAssignee>)=>onChange(ranges.map(r=>r.id===id?{...r,...patch}:r));
  return <div className="space-y-3"><div className="flex items-center justify-between"><Label>Amount-based assignees</Label><Button type="button" size="sm" variant="outline" onClick={()=>onChange([...ranges,{id:crypto.randomUUID(),minAmount:0,maxAmount:null,userId:''}])}><Plus className="mr-1 h-3 w-3"/>Range</Button></div>{ranges.map(r=><div key={r.id} className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 rounded-lg border p-2"><Input type="number" min="0" placeholder="Min" value={r.minAmount} onChange={e=>change(r.id,{minAmount:Number(e.target.value)})}/><Input type="number" min="0" placeholder="No max" value={r.maxAmount??''} onChange={e=>change(r.id,{maxAmount:e.target.value?Number(e.target.value):null})}/><UserSelect users={users} value={r.userId} onChange={userId=>change(r.id,{userId})}/><Button variant="ghost" size="icon" onClick={()=>onChange(ranges.filter(x=>x.id!==r.id))}><Trash2 className="h-4 w-4"/></Button></div>)}</div>;
}
function UserSelect({users,value,onChange,allowNone=false}:{users:User[];value:string;onChange:(value:string)=>void;allowNone?:boolean}){return <Select value={value||undefined} onValueChange={v=>onChange(v==='none'?'':v)}><SelectTrigger><SelectValue placeholder="Select user"/></SelectTrigger><SelectContent>{allowNone&&<SelectItem value="none">None</SelectItem>}{users.map(user=><SelectItem value={user.id} key={user.id}>{personOptionLabel(user)}</SelectItem>)}</SelectContent></Select>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>}
