import { addDays, weekday } from "./dates"
import { dueDay, type Task } from "./model"

export const BUCKETS = ["Overdue", "Today", "This week", "Later", "No date"] as const
export type BucketName = (typeof BUCKETS)[number]

/** "This week" runs through the Sunday of the week `today` is in. */
export function bucketOf(task: Task, today: string): BucketName {
  const due = dueDay(task.dates)
  if (due === null) return "No date"
  if (due < today) return "Overdue"
  if (due === today) return "Today"
  return due <= addDays(today, 7 - weekday(today)) ? "This week" : "Later"
}
