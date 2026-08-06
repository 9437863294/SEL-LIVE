'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowLeft, GripVertical, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { User } from '@/lib/types';
import { DEFAULT_RECURRING_WORKFLOW, RecurringAmountAssignee, RecurringWorkflowStep } from '@/lib/recurring-payments';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  const canEdit=can('Edit Workflow','Recurring Payments.Settings');
  const [steps,setSteps]=useState<RecurringWorkflowStep[]>([]);
  const [users,setUsers]=useState<User[]>([]);
  const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false);
  useEffect(()=>{(async()=>{try{const [workflowSnap,userSnap]=await Promise.all([getDoc(doc(db,'workflows','recurring-payments-workflow')),getDocs(collection(db,'users'))]);setSteps(workflowSnap.exists()&&workflowSnap.data().steps?.length?workflowSnap.data().steps:DEFAULT_RECURRING_WORKFLOW);setUsers(userSnap.docs.map(d=>({id:d.id,...d.data()} as User)).filter(u=>u.status!=='Inactive'));}finally{setLoading(false)}})()},[]);

  const update=(id:string,patch:Partial<RecurringWorkflowStep>)=>setSteps(current=>current.map(step=>step.id===id?{...step,...patch}:step));
  const addStep=()=>setSteps(current=>[...current,{id:crypto.randomUUID(),name:`New Step ${current.length+1}`,description:'',tat:8,assignmentType:'User-based',assignedTo:[],actions:['Approve'],uploadRequired:false}]);
  // Step ids are stable identifiers persisted on live payment obligations (currentStepId,
  // workflowHistory, documentReferences) — never renumber/reassign them on delete or save,
  // or in-flight payments sitting at a later step would silently be reinterpreted as whatever
  // step now occupies that id.
  const removeStep=(id:string)=>setSteps(current=>current.filter(step=>step.id!==id));
  const toggleAction=(step:RecurringWorkflowStep,action:string,checked:boolean)=>update(step.id,{actions:checked?[...new Set([...step.actions,action])]:step.actions.filter(x=>x!==action)});
  async function save(){for(const step of steps){if(!step.name.trim())return toast({title:'Every step needs a name',variant:'destructive'});if(step.assignmentType==='User-based'&&!(step.assignedTo as string[])[0])return toast({title:`Assign a user to ${step.name}`,variant:'destructive'});if(step.assignmentType==='Amount-based'&&!(step.assignedTo as RecurringAmountAssignee[]).some(x=>x.userId))return toast({title:`Add an amount assignee to ${step.name}`,variant:'destructive'});if(!step.actions.length)return toast({title:`Select at least one action for ${step.name}`,variant:'destructive'});}setSaving(true);try{await setDoc(doc(db,'workflows','recurring-payments-workflow'),{module:'Recurring Payments',steps,updatedAt:serverTimestamp()});toast({title:'Recurring payment workflow saved'});}catch{toast({title:'Workflow could not be saved',variant:'destructive'});}finally{setSaving(false)}}
  if(loading)return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin"/></div>;
  return <div className="space-y-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><Link href="/recurring-payments/settings"><Button variant="outline" size="icon"><ArrowLeft className="h-4 w-4"/></Button></Link><div><h1 className="text-2xl font-bold">Workflow Configuration</h1><p className="text-sm text-muted-foreground">Each step automatically creates its own assigned-person work queue.</p></div></div><div className="flex gap-2"><Button variant="outline" onClick={addStep} disabled={!canEdit}><Plus className="mr-2 h-4 w-4"/>Add step</Button><Button onClick={save} disabled={saving||!canEdit}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Save workflow</Button></div></div>
    <div className="space-y-4">{steps.map((step,index)=><Card key={step.id}><CardHeader className="flex flex-row items-start gap-3"><div className="mt-1 rounded-lg bg-indigo-100 p-2 text-indigo-700"><GripVertical className="h-4 w-4"/></div><div className="flex-1"><CardTitle className="text-base">Step {index+1}: {step.name}</CardTitle><CardDescription>{index===0?'Activated automatically at the configured number of days before due date.':'Entered when the previous step completes.'}</CardDescription></div>{steps.length>1&&<Button variant="ghost" size="icon" className="text-destructive" onClick={()=>removeStep(step.id)}><Trash2 className="h-4 w-4"/></Button>}</CardHeader><CardContent className="grid gap-5 md:grid-cols-2">
      <div className="space-y-4"><Field label="Step name"><Input value={step.name} onChange={e=>update(step.id,{name:e.target.value})}/></Field><Field label="Instructions"><Textarea value={step.description} onChange={e=>update(step.id,{description:e.target.value})}/></Field><div className="grid grid-cols-2 gap-3"><Field label="TAT (hours)"><Input type="number" min="1" value={step.tat} onChange={e=>update(step.id,{tat:Math.max(1,Number(e.target.value))})}/></Field><Field label="Assignment"><Select value={step.assignmentType} onValueChange={(assignmentType:RecurringWorkflowStep['assignmentType'])=>update(step.id,{assignmentType,assignedTo:[]})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="Payment-owner">Payment owner</SelectItem><SelectItem value="User-based">Selected users</SelectItem><SelectItem value="Amount-based">Amount ranges</SelectItem></SelectContent></Select></Field></div><div className="flex items-center justify-between rounded-lg border p-3"><Label>Supporting document required</Label><Checkbox checked={step.uploadRequired} onCheckedChange={checked=>update(step.id,{uploadRequired:checked===true})}/></div></div>
      <div className="space-y-4"><AssignmentEditor step={step} users={users} onChange={assignedTo=>update(step.id,{assignedTo})}/><Field label="Allowed actions"><div className="grid grid-cols-2 gap-2">{ACTIONS.map(action=><label key={action} className="flex items-center gap-2 rounded-lg border p-2 text-sm"><Checkbox checked={step.actions.includes(action)} onCheckedChange={v=>toggleAction(step,action,v===true)}/>{action}</label>)}</div></Field></div>
    </CardContent></Card>)}</div>
  </div>;
}

function AssignmentEditor({step,users,onChange}:{step:RecurringWorkflowStep;users:User[];onChange:(value:string[]|RecurringAmountAssignee[])=>void}){
  if(step.assignmentType==='Payment-owner')return <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">The assigned employee from the recurring master receives this step.</div>;
  if(step.assignmentType==='User-based'){const assigned=step.assignedTo as string[];return <div className="space-y-3"><Field label="Primary assignee"><UserSelect users={users} value={assigned[0]||''} onChange={value=>onChange([value,assigned[1]||''].filter(Boolean))}/></Field><Field label="Alternative assignee"><UserSelect users={users} value={assigned[1]||''} allowNone onChange={value=>onChange([assigned[0]||'',value].filter(Boolean))}/></Field></div>}
  const ranges=step.assignedTo as RecurringAmountAssignee[];
  const change=(id:string,patch:Partial<RecurringAmountAssignee>)=>onChange(ranges.map(r=>r.id===id?{...r,...patch}:r));
  return <div className="space-y-3"><div className="flex items-center justify-between"><Label>Amount-based assignees</Label><Button type="button" size="sm" variant="outline" onClick={()=>onChange([...ranges,{id:crypto.randomUUID(),minAmount:0,maxAmount:null,userId:''}])}><Plus className="mr-1 h-3 w-3"/>Range</Button></div>{ranges.map(r=><div key={r.id} className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 rounded-lg border p-2"><Input type="number" min="0" placeholder="Min" value={r.minAmount} onChange={e=>change(r.id,{minAmount:Number(e.target.value)})}/><Input type="number" min="0" placeholder="No max" value={r.maxAmount??''} onChange={e=>change(r.id,{maxAmount:e.target.value?Number(e.target.value):null})}/><UserSelect users={users} value={r.userId} onChange={userId=>change(r.id,{userId})}/><Button variant="ghost" size="icon" onClick={()=>onChange(ranges.filter(x=>x.id!==r.id))}><Trash2 className="h-4 w-4"/></Button></div>)}</div>;
}
function UserSelect({users,value,onChange,allowNone=false}:{users:User[];value:string;onChange:(value:string)=>void;allowNone?:boolean}){return <Select value={value||undefined} onValueChange={v=>onChange(v==='none'?'':v)}><SelectTrigger><SelectValue placeholder="Select user"/></SelectTrigger><SelectContent>{allowNone&&<SelectItem value="none">None</SelectItem>}{users.map(user=><SelectItem value={user.id} key={user.id}>{user.name}</SelectItem>)}</SelectContent></Select>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>}
