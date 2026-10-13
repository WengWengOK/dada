import { getMainWindow } from './window'
import { profileGet, profileSet } from './db'

/** 长春坐标 */
const CITY = { lat: 43.82, lon: 125.32, name: '长春' }
const API = 'https://api.open-meteo.com/v1/forecast'
const CHECK_MS = 30 * 60 * 1000 // 每 30 分钟检查一次
const ALERT_KEY = 'weather_alert_date' // 记录已提示的日期, 一天最多一次

function rainKind(code: number): 'rain' | 'snow' | 'storm' | 'shower' | null {
  if (code >= 71 && code <= 77) return 'snow'
  if (code === 95 || code === 96 || code === 99) return 'storm'
  if (code >= 80 && code <= 82) return 'shower'
  if (code >= 51 && code <= 67) return 'rain'
  return null
}

const todayStr = () => new Date().toISOString().slice(0, 10)

/**
 * 拉取长春天气, 若判定有降水/高降水概率且今天未提示过, 返回提示文案
 * (profile 记录当天已提示, 避免反复打扰)
 */
export async function checkRainAlert(): Promise<string | null> {
  try {
    const url = `${API}?latitude=${CITY.lat}&longitude=${CITY.lon}&current=temperature_2m,weather_code&daily=weather_code,precipitation_probability_max&timezone=Asia%2FShanghai&forecast_days=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      console.log('[weather] fetch failed', res.status)
      return null
    }
    const j = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number }
      daily?: {
        weather_code?: (number | null)[]
        precipitation_probability_max?: (number | null)[]
      }
    }
    const temp = Math.round(j.current?.temperature_2m ?? 0)
    const dayCode = j.daily?.weather_code?.[0] ?? null
    const curCode = j.current?.weather_code ?? 0
    const prob = Math.round(j.daily?.precipitation_probability_max?.[0] ?? 0)
    const kind = dayCode !== null ? rainKind(dayCode) : rainKind(curCode)

    let text: string | null = null
    if (kind === 'snow') text = `外面下雪了❄️ ${CITY.name} ${temp}°C,注意保暖,小心路滑~`
    else if (kind === 'storm') text = `外面有雷阵雨⛈️ ${CITY.name} ${temp}°C,出门带伞,注意安全~`
    else if (kind === 'shower') text = `外面有阵雨☔ ${CITY.name} ${temp}°C,出门记得带伞~`
    else if (kind === 'rain') text = `外面下雨了☔ ${CITY.name} ${temp}°C,出门记得带伞,别淋湿啦~`
    else if (prob >= 50) text = `今天降水概率 ${prob}%🌧️ ${CITY.name} ${temp}°C,带把伞保险哦~`

    if (!text) {
      console.log(
        `[weather] ${CITY.name} ${temp}°C code=${dayCode ?? curCode} prob=${prob}% 无降水, 不提示`
      )
      return null
    }
    if (profileGet(ALERT_KEY) === todayStr()) {
      console.log('[weather] 今天已提示过, 跳过:', text)
      return null
    }
    profileSet(ALERT_KEY, todayStr())
    console.log('[weather] alert:', text)
    return text
  } catch (e) {
    console.log('[weather] error', String(e))
    return null
  }
}

/** 启动天气巡检: 应用启动 10 秒后检查一次, 之后每 30 分钟一次 */
export function startWeatherWatch(): void {
  const tick = () => {
    void checkRainAlert().then((text) => {
      if (text) getMainWindow()?.webContents.send('weather-alert', text)
    })
  }
  setTimeout(tick, 10_000)
  setInterval(tick, CHECK_MS)
}
