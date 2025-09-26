
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

export default function PrintingSetupPage() {
    const { toast } = useToast();
    // In a real app, these states would be initialized from a data source
    const [paperSize, setPaperSize] = useState('a4');
    const [orientation, setOrientation] = useState('portrait');
    const [margins, setMargins] = useState({ top: '20', bottom: '20', left: '20', right: '20' });
    const [headerText, setHeaderText] = useState('SIDDHARTHA ENGINEERING LIMITED');

    const handleMarginChange = (side: keyof typeof margins, value: string) => {
        setMargins(prev => ({ ...prev, [side]: value }));
    };

    const handleSave = () => {
        // In a real app, this would save the settings to a database
        console.log({ paperSize, orientation, margins, headerText });
        toast({
            title: 'Settings Saved',
            description: 'Your printing preferences have been updated.',
        });
    };

    return (
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/daily-requisition/settings">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <h1 className="text-xl font-bold">Printing Setup</h1>
                </div>
                <Button onClick={handleSave}>
                    <Save className="mr-2 h-4 w-4" /> Save Settings
                </Button>
            </div>

            <div className="space-y-8">
                <Card>
                    <CardHeader>
                        <CardTitle>Page Setup</CardTitle>
                        <CardDescription>Configure the paper size and orientation for printed documents.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-2">
                            <Label htmlFor="paper-size">Paper Size</Label>
                            <Select value={paperSize} onValueChange={setPaperSize}>
                                <SelectTrigger id="paper-size">
                                    <SelectValue placeholder="Select paper size" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="a4">A4</SelectItem>
                                    <SelectItem value="letter">Letter</SelectItem>
                                    <SelectItem value="legal">Legal</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Orientation</Label>
                            <RadioGroup value={orientation} onValueChange={setOrientation} className="flex items-center space-x-4">
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="portrait" id="portrait" />
                                    <Label htmlFor="portrait">Portrait</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="landscape" id="landscape" />
                                    <Label htmlFor="landscape">Landscape</Label>
                                </div>
                            </RadioGroup>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Margin Setup</CardTitle>
                        <CardDescription>Set the margins for the printed page (in millimeters).</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="margin-top">Top</Label>
                            <Input id="margin-top" type="number" value={margins.top} onChange={e => handleMarginChange('top', e.target.value)} placeholder="e.g., 20" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="margin-bottom">Bottom</Label>
                            <Input id="margin-bottom" type="number" value={margins.bottom} onChange={e => handleMarginChange('bottom', e.target.value)} placeholder="e.g., 20" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="margin-left">Left</Label>
                            <Input id="margin-left" type="number" value={margins.left} onChange={e => handleMarginChange('left', e.target.value)} placeholder="e.g., 20" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="margin-right">Right</Label>
                            <Input id="margin-right" type="number" value={margins.right} onChange={e => handleMarginChange('right', e.target.value)} placeholder="e.g., 20" />
                        </div>
                    </CardContent>
                </Card>
                
                 <Card>
                    <CardHeader>
                        <CardTitle>Header Setup</CardTitle>
                        <CardDescription>Customize the text that appears at the top of the printed document.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            <Label htmlFor="header-text">Header Text</Label>
                            <Textarea id="header-text" value={headerText} onChange={e => setHeaderText(e.target.value)} />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
