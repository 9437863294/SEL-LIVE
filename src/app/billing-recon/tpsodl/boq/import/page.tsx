

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, UploadCloud, FileSpreadsheet, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useParams } from 'next/navigation';

type BoqItem = {
    [key: string]: any;
};

export default function ImportBoqPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [jsonData, setJsonData] = useState<BoqItem[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || selectedFile.type === 'application/vnd.ms-excel') {
          setFile(selectedFile);
          parseExcel(selectedFile);
      } else {
          toast({
              title: 'Invalid File Type',
              description: 'Please upload a valid Excel file (.xlsx, .xls).',
              variant: 'destructive',
          });
      }
    }
  };
  
  const parseExcel = (fileToParse: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
          const data = event.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json<BoqItem>(worksheet);
          setJsonData(json);
          if (json.length > 0) {
              setHeaders(Object.keys(json[0]));
          }
      };
      reader.onerror = (error) => {
          toast({
            title: 'File Read Error',
            description: 'Could not read the file.',
            variant: 'destructive',
          });
          console.error("FileReader error: ", error);
      };
      reader.readAsBinaryString(fileToParse);
  };

  const handleImport = async () => {
    if (jsonData.length === 0) {
      toast({
        title: 'No data to import',
        description: 'Please select a file with data.',
        variant: 'destructive',
      });
      return;
    }
    setIsImporting(true);

    try {
        const batch = writeBatch(db);
        const boqCollectionRef = collection(db, 'projects', projectSlug, 'boqItems');
        
        jsonData.forEach(item => {
            const docRef = doc(boqCollectionRef);
            batch.set(docRef, item);
        });

        await batch.commit();

        toast({
            title: 'Import Successful',
            description: `${jsonData.length} items have been imported to the BOQ for this project.`,
        });
        setJsonData([]);
        setHeaders([]);
        setFile(null);

    } catch (error) {
        console.error("Error importing data: ", error);
        toast({
            title: 'Import Failed',
            description: 'An error occurred while importing the data.',
            variant: 'destructive',
        });
    } finally {
        setIsImporting(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/boq`}>
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">Import BOQ from Excel</h1>
        </div>
        {jsonData.length > 0 && (
             <Button onClick={handleImport} disabled={isImporting}>
                {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                Import Data
            </Button>
        )}
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Upload File</CardTitle>
            <CardDescription>Select an Excel file (.xlsx or .xls) to import. The data will be displayed below for review before importing.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
             <div className="grid w-full max-w-sm items-center gap-1.5">
                 <Input 
                    id="excel-file" 
                    type="file" 
                    onChange={handleFileChange} 
                    accept=".xlsx, .xls" 
                    className="cursor-pointer file:cursor-pointer file:text-primary file:font-semibold"
                 />
             </div>
             {file && (
                <div className="flex items-center gap-2 text-sm">
                    <FileSpreadsheet className="h-5 w-5 text-green-600" />
                    <span>{file.name}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setFile(null); setJsonData([]); setHeaders([]); }}>
                        <Trash2 className="h-4 w-4 text-destructive"/>
                    </Button>
                </div>
             )}
        </CardContent>
      </Card>
      
      {jsonData.length > 0 && (
        <Card className="mt-6">
            <CardHeader>
                <CardTitle>Preview Data</CardTitle>
                <CardDescription>Review the data from your Excel file before importing. Found {jsonData.length} rows.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {headers.map(header => <TableHead key={header}>{header}</TableHead>)}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {jsonData.map((row, rowIndex) => (
                            <TableRow key={rowIndex}>
                                {headers.map(header => (
                                    <TableCell key={`${rowIndex}-${header}`}>{row[header]}</TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
      )}
    </div>
  );
}

