import ModuleForm from '@/components/ModuleForm';

export default function CreateModulePage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Create New Module</h1>
        <p className="text-muted-foreground">Fill in the details for your new module and use AI to help you out.</p>
      </div>
      <ModuleForm />
    </div>
  );
}
