
'use client';

import { Button } from './ui/button';
import { File as FileIcon } from 'lucide-react';

const DocumentLink = ({ file }: { file: { name: string, url: string }}) => (
    <a href={file.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
        <FileIcon className="h-4 w-4" />
        {file.name}
    </a>
);

export default DocumentLink;
