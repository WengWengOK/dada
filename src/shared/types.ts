/** 主进程与渲染进程共享的类型 */

export interface TaskRow {
  id: number
  title: string
  status: string
  plan_min: number
  created_at: number
  done_at: number | null
}
