
'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function AiForecastPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">AI Forecast</h1>
      <Card>
        <CardHeader>
          <CardTitle>Demand &amp; Stock Forecasting</CardTitle>
        </CardHeader>
        <CardContent>
          <p>AI-powered forecasting tools will be available here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
