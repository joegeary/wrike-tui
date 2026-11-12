import { addDays, weekday } from "./dates"
import { dueDay, IMPORTANCES, type Task } from "./model"

export const BUCKETS = ["Overdue", "Today", "This week", "Later", "No date"] as const
export type BucketName = (typeof BUCKETS)[number]
export type Bucket = { name: BucketName; tasks: Task[] }

/** "This week" runs through the Sunday of the week `today` is in. */
export function bucketOf(task: Task, today: string): BucketName {
  const due = dueDay(task.dates)
  if (due === null) return "No date"
  if (due < today) return "Overdue"
  if (due === today) return "Today"
  return due <= addDays(today, 7 - weekday(today)) ? "This week" : "Later"
}

function compareTasks(a: Task, b: Task): number {
  const [dueA, dueB] = [dueDay(a.dates) ?? "", dueDay(b.dates) ?? ""]
  if (dueA !== dueB) return dueA < dueB ? -1 : 1
  const importance = IMPORTANCES.indexOf(a.importance) - IMPORTANCES.indexOf(b.importance)
  return importance !== 0 ? importance : a.title.localeCompare(b.title)
}

/** Non-empty buckets in display order. */
export function bucketTasks(tasks: Task[], today: string): Bucket[] {
  return BUCKETS.map((name) => ({
    name,
    tasks: tasks.filter((task) => bucketOf(task, today) === name).sort(compareTasks),
  })).filter((bucket) => bucket.tasks.length > 0)
}
