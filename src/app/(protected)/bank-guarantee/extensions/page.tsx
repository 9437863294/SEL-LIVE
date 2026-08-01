import BGLifecycleWorkspace from "@/components/bank-guarantee/lifecycle-workspace";
import BGEntityWorkspace from "@/components/bank-guarantee/entity-workspace";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
export default function Page() {
  return (
    <Tabs defaultValue="extensions">
      <TabsList>
        <TabsTrigger value="extensions">Extensions</TabsTrigger>
        <TabsTrigger value="amendments">Amendments</TabsTrigger>
      </TabsList>
      <TabsContent value="extensions">
        <BGLifecycleWorkspace kind="extensions" />
      </TabsContent>
      <TabsContent value="amendments">
        <BGEntityWorkspace kind="amendments" />
      </TabsContent>
    </Tabs>
  );
}
