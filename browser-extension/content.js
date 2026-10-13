// content.js - 在页面上下文里抽取正文摘要,作为学习"快照"的内容片段
// 只在收到 background 消息时才抽取,避免影响页面性能

(function () {
  if (window.__studyTrackerInjected) return
  window.__studyTrackerInjected = true

  function extractSnippet(maxLen = 600) {
    try {
      // 优先看 meta description / og:title 等
      const metaDesc = document.querySelector('meta[name="description"]')?.content || ''
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || ''
      const ogDesc = document.querySelector('meta[property="og:description"]')?.content || ''

      // 正文启发式: 去掉 nav/footer/aside/script/style,取最长的几段可见文本
      const selectorsToRemove = 'nav, header, footer, aside, noscript, script, style, iframe, .sidebar, #sidebar'
      const root = document.body ? document.body.cloneNode(true) : null
      let mainText = ''
      if (root) {
        root.querySelectorAll(selectorsToRemove).forEach((n) => n.remove())
        mainText = (root.textContent || '').replace(/\s+/g, ' ').trim()
      }

      // 组合,先 title + desc,不够再补正文
      const title = (document.title || '').trim()
      const head = [ogTitle || title, metaDesc || ogDesc].filter(Boolean).join(' | ')
      let combined = head
      if (combined.length < 200 && mainText) {
        combined = (combined + ' · ' + mainText).trim()
      }
      if (!combined && mainText) combined = mainText
      if (combined.length > maxLen) combined = combined.slice(0, maxLen) + '…'
      return {
        title,
        url: location.href,
        snippet: combined
      }
    } catch (e) {
      return { title: document.title || '', url: location.href, snippet: '' }
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return
    if (msg.type === 'extract-snippet') {
      sendResponse(extractSnippet(msg.maxLen || 600))
      return true // 异步响应
    }
  })
})()
