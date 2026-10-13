// ========== 网站分类规则 ==========
const CATEGORIES = {
  study: {
    name: '学习', icon: '📚', color: '#7ee2a8',
    domains: [
      'imooc.com', 'ke.qq.com', 'study.163.com', 'cn.udacity.com',
      'coursera.org', 'geekbang.org', 'time.geekbang.org',
      'leetcode.cn', 'leetcode.com', 'nowcoder.com',
      'runoob.com', 'w3school.com.cn', 'developer.mozilla.org',
      'stackoverflow.com', 'github.com', 'gitee.com',
      'csdn.net', 'jianshu.com', 'juejin.cn', 'cnblogs.com',
      'codefather.cn', 'segmentfault.com', 'kaggle.com',
      'khanacademy.org', 'ted.com', 'icourse163.org',
      'duolingo.cn', 'baicizhan.com', 'shanbay.com',
      'bilibili.com' // 混合,会再按关键词细分
    ]
  },
  work: {
    name: '工作', icon: '💼', color: '#a87cff',
    domains: [
      'gitlab.com', 'jira.com', 'atlassian.net', 'feishu.cn',
      'dingtalk.com', 'notion.so', 'yuque.com', 'trello.com',
      'asana.com', 'office.com', 'docs.google.com'
    ]
  },
  social: {
    name: '社交', icon: '💬', color: '#ff9ad5',
    domains: [
      'weixin.qq.com', 'web.weixin.qq.com', 'wx.qq.com',
      'qzone.qq.com', 'weibo.com', 'xiaohongshu.com',
      'zhihu.com', 'tieba.baidu.com', 'douban.com',
      'linkedin.com', 'facebook.com', 'twitter.com'
    ]
  },
  entertainment: {
    name: '娱乐', icon: '🎮', color: '#ffd166',
    domains: [
      'douyin.com', 'youtube.com', 'youku.com', 'iqiyi.com',
      'v.qq.com', 'twitch.tv', 'netflix.com',
      'music.163.com', 'y.qq.com', 'kugou.com',
      '4399.com', '7k7k.com', 'steamcommunity.com'
    ]
  },
  other: { name: '其他', icon: '📌', color: '#b6acd6', domains: [] }
};

// 学习关键词（用于智能判断B站、知乎等混合内容网站）
const STUDY_KEYWORDS = [
  '教程', '课程', '学习', '编程', '算法', '数据结构', '面试',
  '考研', '数学', '英语', '公开课', 'lecture', 'tutorial',
  'course', 'coding', '开发', '前端', '后端', 'Java', 'Python',
  'JavaScript', 'React', 'Vue', 'CSS', 'HTML', 'SQL', 'Git',
  '讲解', '入门', '实战', '原理', '源码', '笔记', '论文', '知识点'
];

// 娱乐关键词(用于混合内容网站进一步过滤)
const FUN_KEYWORDS = [
  '综艺', '电视剧', '电影', '直播', '游戏', '搞笑', 'vlog',
  '日常', 'reaction', 'cut', '花絮', '明星', '番剧', '动漫',
  '美食', '探店', '开箱', '跳舞', '翻唱'
];

// ========== 与桌面端桥接配置 ==========
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8765';
const BRIDGE_TIMEOUT_MS = 3000;
const SYNC_INTERVAL_MIN = 1; // 每分钟同步一次本地 pending 到桌面端
const SNAPSHOT_INTERVAL_MIN = 5; // 每 5 分钟对当前活动页面做一次快照
const PENDING_KEY_USAGE = 'pending_usage';
const PENDING_KEY_SNAPSHOT = 'pending_snapshots';
const BRIDGE_KEY = 'bridge_url';

// ========== 全局状态 ==========
let currentTab = null;
let isIdle = false;
let lastSnapshotAt = 0;
let bridgeReachable = false; // 最近一次 /ping 是否成功
let lastPingAt = 0;

// 设置空闲检测间隔（60秒无操作判定为空闲）
chrome.idle.setDetectionInterval(60);

// ========== 工具函数 ==========
function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function categorize(domain, title, snippet = '') {
  if (!domain) return 'other';
  const lowerDomain = domain.toLowerCase();
  const lowerTitle = (title || '').toLowerCase();
  const lowerSnippet = (snippet || '').toLowerCase();
  const text = lowerTitle + ' ' + lowerSnippet;

  // 混合内容网站先按关键词
  if (lowerDomain.includes('bilibili.com')) {
    if (STUDY_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) return 'study';
    if (FUN_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) return 'entertainment';
    return 'entertainment';
  }
  if (lowerDomain.includes('zhihu.com')) {
    if (STUDY_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) return 'study';
    return 'social';
  }
  if (lowerDomain.includes('youtube.com')) {
    if (STUDY_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) return 'study';
    return 'entertainment';
  }
  if (lowerDomain.includes('douyin.com') || lowerDomain.includes('tiktok.com')) {
    if (STUDY_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) return 'study';
    return 'entertainment';
  }

  for (const [cat, info] of Object.entries(CATEGORIES)) {
    if (cat === 'other') continue;
    for (const d of info.domains) {
      if (lowerDomain.includes(d)) return cat;
    }
  }
  // 未知域名但标题有学习关键词也判为 study
  if (STUDY_KEYWORDS.some(kw => lowerTitle.includes(kw.toLowerCase()))) return 'study';
  return 'other';
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function getBridgeUrl() {
  const s = await chrome.storage.local.get([BRIDGE_KEY]);
  return s[BRIDGE_KEY] || DEFAULT_BRIDGE_URL;
}

async function setBridgeUrl(url) {
  await chrome.storage.local.set({ [BRIDGE_KEY]: url });
}

// ========== 数据存储(本地 chrome.storage) ==========
async function saveUsage(domain, title, url, category, duration, visits = 1, startTs = 0, endTs = 0) {
  const key = todayKey();
  const data = await chrome.storage.local.get(['siteData', 'dailyTotal']);

  if (!data.siteData) data.siteData = {};
  if (!data.siteData[key]) data.siteData[key] = {};

  const site = data.siteData[key][domain] || {
    domain, title, category, duration: 0, visits: 0
  };

  site.duration += duration;
  site.title = title || site.title;
  site.category = category;
  site.visits += visits;

  data.siteData[key][domain] = site;

  if (!data.dailyTotal) data.dailyTotal = {};
  if (!data.dailyTotal[key]) {
    data.dailyTotal[key] = { study: 0, work: 0, social: 0, entertainment: 0, other: 0 };
  }
  data.dailyTotal[key][category] = (data.dailyTotal[key][category] || 0) + duration;

  await chrome.storage.local.set({ siteData: data.siteData, dailyTotal: data.dailyTotal });

  // 同时 push 到 pending_usage,给桌面端同步
  await pushPendingUsage({
    domain, title, url: url || '', category,
    startTs: startTs || (Date.now() - duration),
    endTs: endTs || Date.now(),
    durationMs: duration, visits
  });
}

// ========== 桌面端桥接: pending 队列 + 批量同步 ==========
async function getPending(key) {
  const r = await chrome.storage.local.get([key]);
  return Array.isArray(r[key]) ? r[key] : [];
}
async function setPending(key, arr) {
  await chrome.storage.local.set({ [key]: arr });
}

async function pushPendingUsage(u) {
  const list = await getPending(PENDING_KEY_USAGE);
  list.push(u);
  // 限制队列长度,避免无限堆积
  if (list.length > 500) list.splice(0, list.length - 500);
  await setPending(PENDING_KEY_USAGE, list);
}

async function pushPendingSnapshot(s) {
  const list = await getPending(PENDING_KEY_SNAPSHOT);
  list.push(s);
  if (list.length > 200) list.splice(0, list.length - 200);
  await setPending(PENDING_KEY_SNAPSHOT, list);
}

async function fetchBridge(path, opts = {}) {
  const base = await getBridgeUrl();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const r = await fetch(base.replace(/\/$/, '') + path, {
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      ...opts
    });
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** 检测桌面端桥接是否可达 */
async function pingBridge() {
  const r = await fetchBridge('/ping', { method: 'GET' });
  const ok = !!(r && r.ok);
  bridgeReachable = ok;
  lastPingAt = Date.now();
  return ok;
}

async function syncPendingToBridge() {
  // 先 ping,避免每次都 fetch 失败
  const ok = await pingBridge();
  if (!ok) return false;

  const usages = await getPending(PENDING_KEY_USAGE);
  const snapshots = await getPending(PENDING_KEY_SNAPSHOT);
  if (usages.length === 0 && snapshots.length === 0) return true;

  const resp = await fetchBridge('/batch', {
    method: 'POST',
    body: JSON.stringify({ usages, snapshots })
  });
  if (!resp || !resp.ok) return false;

  // 发送成功,把队列删掉(简单处理,若部分失败下轮重试整体也无妨)
  await setPending(PENDING_KEY_USAGE, []);
  await setPending(PENDING_KEY_SNAPSHOT, []);
  return true;
}

// ========== 快照: 向当前活动 tab 的 content script 要 snippet ==========
async function takeSnapshotNow(tab) {
  if (!tab || !tab.id || !tab.url || !tab.url.startsWith('http')) return;
  try {
    // 先尝试直接向 content script 发消息(已经注入的页面)
    let resp = null;
    try {
      resp = await chrome.tabs.sendMessage(tab.id, { type: 'extract-snippet', maxLen: 500 });
    } catch {
      // 可能页面还没注入 content script,尝试动态注入一次
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        resp = await chrome.tabs.sendMessage(tab.id, { type: 'extract-snippet', maxLen: 500 });
      } catch {
        // ignore
      }
    }
    const domain = extractDomain(tab.url);
    if (!domain) return;
    const title = resp?.title || tab.title || domain;
    const snippet = resp?.snippet || '';
    const url = resp?.url || tab.url || '';
    const cat = categorize(domain, title, snippet);

    const snap = {
      source: 'web',
      domain,
      title,
      content: snippet,
      category: cat,
      url,
      process: '',
      createdAt: Date.now()
    };
    await pushPendingSnapshot(snap);
  } catch {
    // ignore
  }
}

// ========== 追踪逻辑 ==========
async function startTracking(tab) {
  if (!tab || !tab.url || !tab.url.startsWith('http')) return;

  await flushCurrentTab();

  const domain = extractDomain(tab.url);
  if (!domain) return;

  currentTab = {
    tabId: tab.id,
    domain,
    title: tab.title || domain,
    url: tab.url,
    category: categorize(domain, tab.title),
    startTime: Date.now()
  };

  await chrome.storage.local.set({ currentTab });

  // 进入一个学习/工作类页面时立刻做一次快照
  if (currentTab.category === 'study' || currentTab.category === 'work') {
    trySnapshotForCurrent(tab);
  }
}

async function trySnapshotForCurrent(tab) {
  const now = Date.now();
  if (now - lastSnapshotAt < SNAPSHOT_INTERVAL_MIN * 60_000) return;
  lastSnapshotAt = now;
  await takeSnapshotNow(tab);
}

async function flushCurrentTab() {
  if (!currentTab) return;

  let duration = Date.now() - currentTab.startTime;
  duration = Math.min(duration, 5 * 60 * 1000);

  if (duration >= 1000) {
    await saveUsage(
      currentTab.domain,
      currentTab.title,
      currentTab.url,
      currentTab.category,
      duration,
      1,
      currentTab.startTime,
      Date.now()
    );
  }

  currentTab = null;
  await chrome.storage.local.set({ currentTab: null });
}

// ========== 事件监听 ==========

// 标签页切换
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (isIdle) return;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await startTracking(tab);
  } catch (e) {}
});

// URL变化
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active && !isIdle) {
    await startTracking(tab);
  }
  // 标题更新时(如文章加载完)尝试做一次学习快照
  if (changeInfo.title && tab.active && !isIdle && currentTab && currentTab.tabId === tabId) {
    currentTab.title = changeInfo.title;
    currentTab.category = categorize(currentTab.domain, changeInfo.title);
  }
});

// 窗口焦点变化
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await flushCurrentTab();
  } else if (!isIdle) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab) await startTracking(tab);
    } catch (e) {}
  }
});

// 空闲检测
chrome.idle.onStateChanged.addListener(async (idleState) => {
  if (idleState === 'idle' || idleState === 'locked') {
    isIdle = true;
    await flushCurrentTab();
  } else if (idleState === 'active') {
    isIdle = false;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await startTracking(tab);
    } catch (e) {}
  }
});

// 定时保存 + 快照 + 同步桌面端
chrome.alarms.create('tick', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tick') return;

  // 1. flush 当前 tab
  if (!isIdle) {
    await flushCurrentTab();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await startTracking(tab);
        // 每 N 分钟定期一次快照
        const now = Date.now();
        if (now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MIN * 60_000) {
          lastSnapshotAt = now;
          await takeSnapshotNow(tab);
        }
      }
    } catch (e) {}
  }

  // 2. 同步到桌面端
  try {
    await syncPendingToBridge();
  } catch {}
});

// ========== 对外消息(popup 查询桥接状态 / 手动同步 / 配置端口) ==========
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;
  (async () => {
    switch (msg.type) {
      case 'bridge:status': {
        // popup 打开时主动 ping 一次拿最新状态
        let ok = bridgeReachable;
        if (Date.now() - lastPingAt > 20_000) {
          ok = await pingBridge();
        }
        const pendingUsages = await getPending(PENDING_KEY_USAGE);
        const pendingSnapshots = await getPending(PENDING_KEY_SNAPSHOT);
        sendResponse({
          ok: true,
          reachable: ok,
          bridgeUrl: await getBridgeUrl(),
          pendingUsages: pendingUsages.length,
          pendingSnapshots: pendingSnapshots.length
        });
        break;
      }
      case 'bridge:sync-now': {
        const ok = await syncPendingToBridge();
        sendResponse({ ok });
        break;
      }
      case 'bridge:set-url': {
        if (msg.url) {
          await setBridgeUrl(msg.url);
          await pingBridge();
        }
        sendResponse({ ok: true });
        break;
      }
      case 'snapshot:now': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) await takeSnapshotNow(tab);
        sendResponse({ ok: true });
        break;
      }
    }
  })();
  return true; // 异步响应
});

// ========== 初始化 ==========

chrome.storage.local.get(['currentTab']).then((result) => {
  if (result.currentTab) {
    currentTab = result.currentTab;
    flushCurrentTab().then(() => {
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]) startTracking(tabs[0]);
      });
    });
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]) startTracking(tabs[0]);
    });
  }
  // 启动后先试一次 ping 看看桌面端在不在
  pingBridge().catch(() => {});
  // 立刻同步一次(如果之前有挂起数据)
  syncPendingToBridge().catch(() => {});
});

chrome.runtime.onInstalled.addListener(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await startTracking(tab);
});
