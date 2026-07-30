/** 全局专注状态(番茄钟运行中)。主进程巡检据此跳过打扰。 */
let focusing = false

export function setFocusing(v: boolean): void {
  focusing = v
}

export function isFocusing(): boolean {
  return focusing
}
