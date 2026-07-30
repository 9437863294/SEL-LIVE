'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { RP_COLLECTIONS, type PaymentObligation } from '@/lib/recurring-payments';
import { Card, CardContent } from '@/components/ui/card';

export default function PaymentActionRedirect({paymentId,action}:{paymentId:string;action:'approve'|'record-payment'}){const router=useRouter();const [message,setMessage]=useState('Opening the assigned workflow action…');useEffect(()=>{getDoc(doc(db,RP_COLLECTIONS.payments,paymentId)).then(snapshot=>{if(!snapshot.exists()){setMessage('Payment not found.');return}const payment={id:snapshot.id,...snapshot.data()} as PaymentObligation;if(payment.currentStepId){router.replace(`/recurring-payments/stage/${payment.currentStepId}`);return}setMessage(action==='approve'?'This payment is not currently awaiting an approval action.':'This payment has no active processing step. Open its details to review the current status.');setTimeout(()=>router.replace(`/recurring-payments/payments/${paymentId}`),1400)}).catch(()=>setMessage('Could not open the workflow action.'))},[action,paymentId,router]);return <Card><CardContent className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600"/><p className="text-sm text-muted-foreground">{message}</p></CardContent></Card>}
