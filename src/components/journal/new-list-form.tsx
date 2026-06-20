"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { addList } from "@/app/(app)/settings/actions";

export function NewListForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("Context");
  const [pending, start] = useTransition();

  function submit() {
    if (!label.trim()) return;
    start(async () => {
      const key = label;
      const res = await addList(key, label, category);
      if (!res.ok) toast.error(res.error);
      else {
        setLabel("");
        setOpen(false);
        toast.success("List created");
        router.refresh();
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" /> New list
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <p className="text-sm font-medium">New dropdown list</p>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="List name (e.g. Broker)"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["Context", "ICT Setup", "Risk", "Psychology"].map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="w-full"
          disabled={pending || !label.trim()}
          onClick={submit}
        >
          Create
        </Button>
      </PopoverContent>
    </Popover>
  );
}
