import { useEffect } from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { CATEGORY_LABELS_VI, BUCKET_LABELS_VI, EXPENSE_CATEGORIES } from "@/domain/constants"
import type { ExpenseCategory } from "@/domain/types"
import MoneyInput from "@/components/MoneyInput"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { ExpenseTemplate } from "@/storage/templates"

export type QuickTemplateFormValues = {
  name: string
  amountVnd: number
  category: ExpenseCategory
  bucket: "NEEDS" | "WANTS"
  note: string
}

type QuickTemplateEditorDrawerProps = {
  open: boolean
  mode: "create" | "edit"
  template?: ExpenseTemplate | null
  onOpenChange: (open: boolean) => void
  onSave: (values: QuickTemplateFormValues) => void
}

const schema = z.object({
  name: z.string().trim().min(1, { message: "Tên mẫu không được để trống." }).max(80),
  amountVnd: z.coerce.number().int().positive({ message: "Số tiền phải > 0." }),
  category: z.custom<ExpenseCategory>(),
  bucket: z.custom<"NEEDS" | "WANTS">(),
  note: z.string().max(200).optional(),
})

type FormValues = z.infer<typeof schema>

export default function QuickTemplateEditorDrawer({
  open,
  mode,
  template,
  onOpenChange,
  onSave,
}: QuickTemplateEditorDrawerProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      amountVnd: 0,
      category: "Food",
      bucket: "NEEDS",
      note: "",
    },
  })

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && template) {
      form.reset({
        name: template.name,
        amountVnd: template.amount,
        category: template.category,
        bucket: template.bucket,
        note: template.note ?? "",
      })
      return
    }
    form.reset({
      name: "",
      amountVnd: 0,
      category: "Food",
      bucket: "NEEDS",
      note: "",
    })
  }, [form, mode, open, template])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-auto right-0 top-0 h-dvh w-full max-w-lg translate-x-0 translate-y-0 rounded-none border-l p-0">
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>
              {mode === "create" ? "Thêm item nhanh" : "Sửa item nhanh"}
            </DialogTitle>
          </DialogHeader>

          <form
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4"
            onSubmit={form.handleSubmit((values) => {
              onSave({
                name: values.name.trim(),
                amountVnd: values.amountVnd,
                category: values.category,
                bucket: values.bucket,
                note: values.note?.trim() ?? "",
              })
            })}
          >
            <div className="grid gap-2">
              <Label>Tên mẫu</Label>
              <Input
                placeholder="Ví dụ: Ăn uống • Cafe sáng"
                {...form.register("name")}
              />
              {form.formState.errors.name ? (
                <div className="text-xs text-destructive">{form.formState.errors.name.message}</div>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label>Số tiền (VND)</Label>
              <Controller
                control={form.control}
                name="amountVnd"
                render={({ field }) => (
                  <MoneyInput
                    value={Number(field.value) || 0}
                    onValueChange={field.onChange}
                    placeholder="Ví dụ: 35.000"
                    showSteppers
                  />
                )}
              />
              {form.formState.errors.amountVnd ? (
                <div className="text-xs text-destructive">
                  {form.formState.errors.amountVnd.message}
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Danh mục</Label>
                <Select
                  value={form.watch("category")}
                  onValueChange={(value) => form.setValue("category", value as ExpenseCategory)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn danh mục" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {CATEGORY_LABELS_VI[category]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Bucket</Label>
                <Select
                  value={form.watch("bucket")}
                  onValueChange={(value) => form.setValue("bucket", value as "NEEDS" | "WANTS")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn bucket" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEEDS">{BUCKET_LABELS_VI.needs}</SelectItem>
                    <SelectItem value="WANTS">{BUCKET_LABELS_VI.wants}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Ghi chú</Label>
              <Textarea rows={3} placeholder="Ghi chú mẫu (tuỳ chọn)" {...form.register("note")} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <Button type="submit">
                {mode === "create" ? "Tạo mẫu" : "Lưu thay đổi"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
