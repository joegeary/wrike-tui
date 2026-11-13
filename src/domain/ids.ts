declare const brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type TaskId = Brand<string, "TaskId">
export type LegacyItemId = Brand<string, "LegacyItemId">
export type UserId = Brand<string, "UserId">
export type CustomStatusId = Brand<string, "CustomStatusId">
export type SpaceId = Brand<string, "SpaceId">
export type FolderId = Brand<string, "FolderId">
export type CommentId = Brand<string, "CommentId">
export type AttachmentId = Brand<string, "AttachmentId">
export type CustomFieldId = Brand<string, "CustomFieldId">

export const taskId = (raw: string) => raw as TaskId
export const userId = (raw: string) => raw as UserId
export const customStatusId = (raw: string) => raw as CustomStatusId
export const spaceId = (raw: string) => raw as SpaceId
export const folderId = (raw: string) => raw as FolderId
export const commentId = (raw: string) => raw as CommentId
export const attachmentId = (raw: string) => raw as AttachmentId
export const customFieldId = (raw: string) => raw as CustomFieldId

/** Accepts a bare number or the MCP form `w:itm:4598459124`. */
export function legacyItemId(raw: string): LegacyItemId | null {
  const match = /^(?:w:itm:)?(\d+)$/.exec(raw.trim())
  return match ? (match[1] as LegacyItemId) : null
}
