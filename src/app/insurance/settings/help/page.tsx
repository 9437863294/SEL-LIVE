
'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export default function InsuranceHelpPage() {
    return (
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href="/insurance/settings">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold">Insurance Help & Information</h1>
                        <p className="text-sm text-muted-foreground">Learn about different types of project insurance.</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
                <Card>
                    <CardHeader>
                        <CardTitle>Property Insurance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Accordion type="single" collapsible className="w-full">
                            <AccordionItem value="item-1">
                                <AccordionTrigger>How it Works</AccordionTrigger>
                                <AccordionContent className="space-y-4">
                                    <div>
                                        <h4 className="font-semibold">Proposal & Issuance</h4>
                                        <p className="text-sm text-muted-foreground">You submit details of property (location, type, value, usage). Insurance company issues a policy with coverage, exclusions, premium, and validity (usually 1 year).</p>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold">Coverage Period</h4>
                                        <p className="text-sm text-muted-foreground">The property is protected against insured risks during the policy term. Any damage/loss should be reported immediately.</p>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold">Claim Process</h4>
                                        <p className="text-sm text-muted-foreground">Report damage → Surveyor inspection → Loss assessment → Claim settlement (repair cost or replacement value, depending on policy).</p>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                            <AccordionItem value="item-2">
                                <AccordionTrigger>Key Points on Renewal</AccordionTrigger>
                                <AccordionContent>
                                    <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-2">
                                        <li>Both Property and WC policies are typically yearly.</li>
                                        <li>Timely renewal is critical—a lapse means no coverage.</li>
                                        <li>Premium may change based on claims history or updated property value.</li>
                                        <li>Most insurers offer a grace period (7–30 days), but coverage may not be active until renewal is complete.</li>
                                    </ul>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Workmen’s Compensation (WC) Insurance</CardTitle>
                    </CardHeader>
                    <CardContent>
                         <Accordion type="single" collapsible className="w-full">
                            <AccordionItem value="item-1">
                                <AccordionTrigger>How it Works</AccordionTrigger>
                                <AccordionContent className="space-y-4">
                                    <div>
                                        <h4 className="font-semibold">Proposal & Issuance</h4>
                                        <p className="text-sm text-muted-foreground">Employer provides details like number of employees, nature of work, wages, and risk category. Insurer issues policy covering employer’s liability under the WC Act.</p>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold">Coverage Period</h4>
                                        <p className="text-sm text-muted-foreground">Policy is valid usually for 1 year and covers all accidents/injuries occurring during work in this period.</p>
                                    </div>
                                     <div>
                                        <h4 className="font-semibold">Claim Process</h4>
                                        <p className="text-sm text-muted-foreground">If an employee gets injured/dies → employer informs insurer. Insurer verifies details, medical reports, wages, liability under WC Act. Compensation is paid to employee or nominee.</p>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                             <AccordionItem value="item-2">
                                <AccordionTrigger>Key Points on Renewal</AccordionTrigger>
                                <AccordionContent>
                                    <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-2">
                                        <li>Annual renewal is standard.</li>
                                        <li>Premium depends on employee strength, payroll, and risk classification.</li>
                                        <li>You must update employee data at each renewal (new joiners, wage changes, etc.).</li>
                                    </ul>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
