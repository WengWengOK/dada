import { nativeImage, Tray, Menu, app } from 'electron'
import { toggleWindow, resetWindowPosition } from './window'
import { getPersona, setPersona } from './llm/qwen'
import { PERSONAS, type PersonaId } from './llm/persona'
import { deflateSync } from 'node:zlib'

/** 生成一个 16x16 纯色 PNG 作为托盘图标(免外部资源)。 */
function makeIcon(r: number, g: number, b: number): Electron.NativeImage {
  const W = 16
  const H = 16
  // 每行: 1 字节 filter + W*3 字节 RGB
  const raw = Buffer.alloc((W * 3 + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0 // filter none
    for (let x = 0; x < W; x++) {
      const o = y * (W * 3 + 1) + 1 + x * 3
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
    }
  }
  const compressed = deflateSync(raw)

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const chunks = [
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]
  return nativeImage.createFromBuffer(Buffer.concat([sig, ...chunks]))
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

let tray: Tray | null = null

export function createTray(): void {
  const icon = makeIcon(168, 124, 255) // 淡紫
  tray = new Tray(icon)
  tray.setToolTip('陪伴搭子')

  const rebuild = () => {
    const cur = getPersona()
    const personaItems = (Object.keys(PERSONAS) as PersonaId[]).map((id) => ({
      label: `${PERSONAS[id].emoji} ${PERSONAS[id].name}`,
      type: 'radio' as const,
      checked: id === cur,
      click: () => setPersona(id)
    }))

    tray!.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示搭子', click: () => toggleWindow() },
        { label: '重置窗口位置', click: () => resetWindowPosition() },
        { type: 'separator' },
        { label: '人格', submenu: personaItems },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() }
      ])
    )
  }

  rebuild()
  tray.on('click', () => toggleWindow())
}
