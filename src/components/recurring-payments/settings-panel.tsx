'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { BellRing, Bot, Building2, GitBranch, Loader2, Plus, ShieldCheck } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { ApprovalRule, DEFAULT_PAYMENT_CATEGORIES, DEFAULT_RECURRING_PAYMENT_SETTINGS, RecurringPaymentSettings, RP_COLLECTIONS, currency } from '@/lib/recurring-payments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

const settingDocId = (organizationId: string) => organizationId.replace(/[^a-zA-Z0-9_-]/g, '_');
const parseNumbers = (value: string) => [...new Set(value.split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0))].sort((a,b)=>b-a);

export default function RecurringPaymentSettingsPanel({ organizationId }: { organizationId: string }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<RecurringPaymentSettings>({ ...DEFAULT_RECURRING_PAYMENT_SETTINGS, organizationId });
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [daysBeforeText, setDaysBeforeText] = useState('7, 3, 1, 0');
  const [daysAfterText, setDaysAfterText] = useState('1');
  const [recipientsText, setRecipientsText] = useState('Assigned Employee, Accounts Team');

  useEffect(() => {
    const settingsRef = doc(db, RP_COLLECTIONS.settings, settingDocId(organizationId));
    const stopSettings = onSnapshot(settingsRef, snap => {
      if (!snap.exists()) return;
      const data = snap.data() as Partial<RecurringPaymentSettings>;
      const merged = {
        ...DEFAULT_RECURRING_PAYMENT_SETTINGS, ...data, organizationId,
        notifications: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.notifications, ...data.notifications },
        automation: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.automation, ...data.automation },
        controls: { ...DEFAULT_RECURRING_PAYMENT_SETTINGS.controls, ...data.controls },
      };
      setSettings(merged);
      setDaysBeforeText(merged.notifications.daysBefore.join(', '));
      setDaysAfterText(merged.notifications.daysAfter.join(', '));
      setRecipientsText(merged.notifications.recipients.join(', '));
    });
    const stopRules = onSnapshot(query(collection(db, RP_COLLECTIONS.approvalRules), where('organizationId','==',organizationId)), snap => {
      setRules(snap.docs.map(item => ({ id: item.id, ...item.data() })) as ApprovalRule[]);
    });
    return () => { stopSettings(); stopRules(); };
  }, [organizationId]);

  async function save(section: 'notifications' | 'automation' | 'controls' | 'organization') {
    setSaving(true);
    try {
      const valueToSave = section === 'notifications' ? {
        ...settings,
        notifications: {
          ...settings.notifications,
          daysBefore: parseNumbers(daysBeforeText),
          daysAfter: parseNumbers(daysAfterText),
          recipients: recipientsText.split(',').map(x=>x.trim()).filter(Boolean),
        },
      } : settings;
      await setDoc(doc(db, RP_COLLECTIONS.settings, settingDocId(organizationId)), {
        ...valueToSave, organizationId, updatedAt: serverTimestamp(),
      }, { merge: true });
      setSettings(valueToSave);
      toast({ title: `${section === 'organization' ? 'Organization controls' : section[0].toUpperCase()+section.slice(1)} saved` });
    } catch {
      toast({ title: 'Settings could not be saved', variant: 'destructive' });
    } finally { setSaving(false); }
  }

  const activeRules = useMemo(() => rules.filter(r => r.active).length, [rules]);
  return <>
    <Card className="mb-4 border-indigo-200 bg-indigo-50/40"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Payment Workflow</p><p className="text-sm text-muted-foreground">Configure workflow steps, assigned users, TAT, required documents and actions.</p></div><Link href="/recurring-payments/settings/workflow"><Button><GitBranch className="mr-2 h-4 w-4"/>Configure workflow</Button></Link></CardContent></Card>
    <Tabs defaultValue="approvals" className="space-y-4">
      <TabsList className="grid h-auto w-full grid-cols-2 lg:grid-cols-4">
        <TabsTrigger value="approvals">Approval Rules</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="automation">Automation</TabsTrigger>
        <TabsTrigger value="organization">Organization</TabsTrigger>
      </TabsList>

      <TabsContent value="approvals"><Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-indigo-600"/>Approval Rules</CardTitle><CardDescription>{activeRules} active rule(s). Rules can be sequential or parallel and scoped by amount, category, and project.</CardDescription></div><Button onClick={()=>setRuleOpen(true)}><Plus className="mr-2 h-4 w-4"/>New rule</Button></CardHeader><CardContent className="space-y-3">
        {rules.map(rule => <div key={rule.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{rule.name}</p><Badge variant="outline">{rule.mode}</Badge><Badge variant={rule.active?'default':'secondary'}>{rule.active?'Active':'Inactive'}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{currency(rule.minAmount)} to {rule.maxAmount ? currency(rule.maxAmount) : 'No limit'} · {rule.category || 'All categories'} · {rule.project || 'All projects'}</p><p className="mt-1 text-xs text-muted-foreground">Approvers: {rule.approvers.join(' → ')}{rule.finalAccountsVerification?' → Accounts verification':''}</p></div><Switch checked={rule.active} onCheckedChange={active=>updateDoc(doc(db,RP_COLLECTIONS.approvalRules,rule.id),{active,updatedAt:serverTimestamp()})}/></div>)}
        {!rules.length && <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">No approval rules configured. Add the first amount-based rule.</div>}
      </CardContent></Card></TabsContent>

      <TabsContent value="notifications"><Card><CardHeader><CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5 text-violet-600"/>Notification Rules</CardTitle><CardDescription>Configure channels, reminder schedule, overdue escalation, and recipients.</CardDescription></CardHeader><CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">{([['inApp','In-app notification'],['email','Email'],['push','Push notification'],['sms','WhatsApp / SMS']] as const).map(([key,label])=><ToggleRow key={key} label={label} checked={settings.notifications[key]} onChange={value=>setSettings(s=>({...s,notifications:{...s.notifications,[key]:value}}))}/>)}</div>
        <div className="grid gap-4 sm:grid-cols-2"><SettingField label="Days before due date" help="Comma-separated, including 0 for due date"><Input value={daysBeforeText} onChange={e=>setDaysBeforeText(e.target.value)}/></SettingField><SettingField label="Days after due date" help="Comma-separated escalation days"><Input value={daysAfterText} onChange={e=>setDaysAfterText(e.target.value)}/></SettingField></div>
        <SettingField label="Recipients" help="Comma-separated roles"><Input value={recipientsText} onChange={e=>setRecipientsText(e.target.value)}/></SettingField>
        <ToggleRow label="Daily overdue escalation" checked={settings.notifications.dailyOverdueEscalation} onChange={value=>setSettings(s=>({...s,notifications:{...s.notifications,dailyOverdueEscalation:value}}))}/>
        <div className="flex justify-end"><SaveButton saving={saving} onClick={()=>save('notifications')}/></div>
      </CardContent></Card></TabsContent>

      <TabsContent value="automation"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-blue-600"/>Automation</CardTitle><CardDescription>The daily cron checks these settings before generating organization + master + cycle records.</CardDescription></CardHeader><CardContent className="space-y-6">
        <ToggleRow label="Enable automatic payment generation" checked={settings.automation.enabled} onChange={value=>setSettings(s=>({...s,automation:{...s.automation,enabled:value}}))}/>
        <div className="grid gap-4 sm:grid-cols-3"><SettingField label="Monthly generation day" help="1–28; create the cycle on or after this day"><Input type="number" min={1} max={28} value={settings.automation.generationDay} onChange={e=>setSettings(s=>({...s,automation:{...s.automation,generationDay:Math.min(28,Math.max(1,Number(e.target.value)))}}))}/></SettingField><SettingField label="Workflow starts before due" help="Days before due date; default is 7"><Input type="number" min={0} max={90} value={settings.automation.workflowActivationDays} onChange={e=>setSettings(s=>({...s,automation:{...s.automation,workflowActivationDays:Math.min(90,Math.max(0,Number(e.target.value)))}}))}/></SettingField><SettingField label="Timezone"><Select value={settings.automation.timezone} onValueChange={timezone=>setSettings(s=>({...s,automation:{...s.automation,timezone}}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{['Asia/Kolkata','UTC','Asia/Dubai','Asia/Singapore'].map(x=><SelectItem value={x} key={x}>{x}</SelectItem>)}</SelectContent></Select></SettingField></div>
        <ToggleRow label="Retry failed notifications" checked={settings.automation.retryFailedNotifications} onChange={value=>setSettings(s=>({...s,automation:{...s.automation,retryFailedNotifications:value}}))}/>
        <div className="rounded-lg bg-muted p-3 font-mono text-xs">Cycle key: organizationId_masterId_YYYY-MM</div><div className="flex justify-end"><SaveButton saving={saving} onClick={()=>save('automation')}/></div>
      </CardContent></Card></TabsContent>

      <TabsContent value="organization"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-emerald-600"/>Organization Controls</CardTitle><CardDescription>Data isolation and payment-control policy for this organization.</CardDescription></CardHeader><CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2"><SettingField label="Organization ID" help="Read-only data-scope key"><Input value={organizationId} disabled/></SettingField><SettingField label="Organization display name"><Input value={settings.organizationName} onChange={e=>setSettings(s=>({...s,organizationName:e.target.value}))}/></SettingField></div>
        <div className="grid gap-3 sm:grid-cols-2"><ToggleRow label="Lock closed payments" checked={settings.controls.lockClosedPayments} onChange={value=>setSettings(s=>({...s,controls:{...s.controls,lockClosedPayments:value}}))}/><ToggleRow label="Require bill before approval" checked={settings.controls.requireBillBeforeApproval} onChange={value=>setSettings(s=>({...s,controls:{...s.controls,requireBillBeforeApproval:value}}))}/><ToggleRow label="Require transaction reference" checked={settings.controls.requireTransactionReference} onChange={value=>setSettings(s=>({...s,controls:{...s.controls,requireTransactionReference:value}}))}/><ToggleRow label="Allow authorized reopening" checked={settings.controls.allowAuthorizedReopen} onChange={value=>setSettings(s=>({...s,controls:{...s.controls,allowAuthorizedReopen:value}}))}/></div>
        <SettingField label="Amount variance warning (%)" help="Triggers additional review above this variance"><Input className="max-w-xs" type="number" min={0} max={1000} value={settings.controls.varianceWarningPercent} onChange={e=>setSettings(s=>({...s,controls:{...s.controls,varianceWarningPercent:Number(e.target.value)}}))}/></SettingField>
        <div className="flex justify-end"><SaveButton saving={saving} onClick={()=>save('organization')}/></div>
      </CardContent></Card></TabsContent>
    </Tabs>
    <ApprovalRuleDialog open={ruleOpen} onClose={()=>setRuleOpen(false)} organizationId={organizationId}/>
  </>;
}

function ApprovalRuleDialog({open,onClose,organizationId}:{open:boolean;onClose:()=>void;organizationId:string}) {
  const { toast }=useToast(); const [saving,setSaving]=useState(false);
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);const f=new FormData(e.currentTarget);try{const max=String(f.get('maxAmount')||'');const approvers=String(f.get('approvers')||'').split(/[\n,]/).map(x=>x.trim()).filter(Boolean);await addDoc(collection(db,RP_COLLECTIONS.approvalRules),{organizationId,name:f.get('name'),minAmount:Number(f.get('minAmount')||0),maxAmount:max?Number(max):null,category:f.get('category')==='*'?'':f.get('category'),project:f.get('project'),mode:f.get('mode'),approvers,finalAccountsVerification:f.get('accounts')==='yes',active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});toast({title:'Approval rule created'});onClose();}catch{toast({title:'Could not create approval rule',variant:'destructive'});}finally{setSaving(false)}}
  return <Dialog open={open} onOpenChange={v=>!v&&onClose()}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>New approval rule</DialogTitle><DialogDescription>Rules are evaluated by amount, category, and project.</DialogDescription></DialogHeader><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><SettingField label="Rule name"><Input name="name" required/></SettingField><SettingField label="Approval mode"><Select name="mode" defaultValue="Sequential"><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="Sequential">Sequential</SelectItem><SelectItem value="Parallel">Parallel</SelectItem></SelectContent></Select></SettingField><SettingField label="Minimum amount"><Input name="minAmount" type="number" min="0" defaultValue="0" required/></SettingField><SettingField label="Maximum amount" help="Leave blank for no limit"><Input name="maxAmount" type="number" min="0"/></SettingField><SettingField label="Category"><Select name="category" defaultValue="*"><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="*">All categories</SelectItem>{DEFAULT_PAYMENT_CATEGORIES.map(x=><SelectItem value={x} key={x}>{x}</SelectItem>)}</SelectContent></Select></SettingField><SettingField label="Project" help="Leave blank for every project"><Input name="project"/></SettingField><div className="sm:col-span-2"><SettingField label="Approvers in order" help="One per line or comma-separated"><Textarea name="approvers" required placeholder={'Department Head\nAccounts\nDirector'}/></SettingField></div><SettingField label="Final accounts verification"><Select name="accounts" defaultValue="yes"><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="yes">Required</SelectItem><SelectItem value="no">Not required</SelectItem></SelectContent></Select></SettingField><DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={saving}>{saving&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Create rule</Button></DialogFooter></form></DialogContent></Dialog>;
}
function ToggleRow({label,checked,onChange}:{label:string;checked:boolean;onChange:(value:boolean)=>void}){return <div className="flex items-center justify-between rounded-lg border p-3"><Label>{label}</Label><Switch checked={checked} onCheckedChange={onChange}/></div>}
function SettingField({label,help,children}:{label:string;help?:string;children:React.ReactNode}){return <div className="space-y-1.5"><Label>{label}</Label>{children}{help&&<p className="text-xs text-muted-foreground">{help}</p>}</div>}
function SaveButton({saving,onClick}:{saving:boolean;onClick:()=>void}){return <Button onClick={onClick} disabled={saving}>{saving&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Save configuration</Button>}
