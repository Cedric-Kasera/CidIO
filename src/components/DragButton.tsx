import { GripVerticalIcon } from "lucide-react";
import { Button } from "@/components";

export const DragButton = () => {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="-ml-[2px] w-fit bg-transparent hover:bg-transparent dark:hover:bg-transparent active:bg-transparent"
      data-tauri-drag-region
    >
      <GripVerticalIcon className="h-4 w-4" />
    </Button>
  );
};
