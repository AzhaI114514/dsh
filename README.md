# dsh-fairy-wake

**中文** · [English](#english)

给 DeepSeek Harness 的**唤醒词语音输入**：麦克风常开监听，听到「**你好Fairy**」或直接说「**Fairy**」后开始听写，用官方实验性语音输入 Bundle 的 SenseVoice 本地识别把指令转成文字，**直接发送**（默认开启，可在设置里关成只插入）。

> 面向 Fairy 桌面：和 `dsh-fairy-zzz` 皮肤、`dsh-tts-bridge`/Fairy TTS 朗读互补，不依赖它们。

## 依赖

- DSH `0.2.1` 系列（Web GUI）。
- 官方 **experimental voice-input bundle**（默认 desktop/web profile 的 `dsh.profile.bundles` 里已带）：
  - `@deepseek-ai/dsh-experimental-voice-input-bundle`
  - `@deepseek-ai/dsh-experimental-api-speech-to-text`
  - `@deepseek-ai/dsh-experimental-speech-to-text-sensevoice`
- SenseVoice 模型（约 240 MB）。首次启用会自动准备；也可先在输入框点一次官方麦克风按钮完成安装。

## 安装

一条命令（推荐）：

```bash
dsh plugin --profile desktop add github:AzhaI114514/dsh
```

装完**重启一次 DSH**，设置里会出现「语音唤醒」。

不想敲命令行：去 [Releases](https://github.com/AzhaI114514/dsh/releases) 下 `dsh-fairy-wake-0.1.1.zip`，解压到 `~/.dsh/plugins/`，再运行：

```bash
dsh plugin --profile desktop add link:<解压出来的那个目录>
```

> 插件自带 `cordis.patch.yml`，`dsh plugin add` 会自动把它挂进 profile 的 bundle 层，不用手改 profile 的 `cordis.patch.yml`。

## 使用

| 操作 | 结果 |
|---|---|
| 说「**你好Fairy**」或「**Fairy**」 | 🎙 标签变成「请说指令…」，开始听下一句 |
| 说「你好Fairy，现在几点」/「Fairy，现在几点」 | 一句里带指令时直接识别，唤醒词被去掉，**直接发送** |
| 说唤醒词后再说指令 | 同样直接发送 |
| 设置 → 语音唤醒 | 开关、直接发送（默认开）、自定义第一唤醒词 |

- 识别在 Host CPU 上跑 SenseVoice（同一套官方服务），不联网、不需要 API。
- 状态标签：🎙 语音唤醒已关 / 准备语音模型… / 说「你好Fairy」或「Fairy」 / 在听… / 请说指令… / 识别中… / 唤醒出错（点它重试）。
- 唤醒词匹配对 SenseVoice 的转写误差做了容错：fairy / fary / fry / 法瑞 / 菲瑞 / 飞瑞… 都能命中；单独说「Fairy」也算唤醒。
- 默认**识别后直接发送**；在设置里可以关掉「识别后直接发送」退回只插入草稿。

## 已知限制

- 麦克风常开，会占用默认输入设备；与官方语音输入按钮同时使用可能互相抢麦。
- 只在**已打开会话**的输入框区域挂载；空白「新会话」页（还没有 session）不会开始监听，发生第一条消息后自动挂载。
- 首次启用需下载 SenseVoice 模型；下载失败时先在输入框点官方麦克风按钮完成安装，再点 🎙 重试。
- 环境需要允许麦克风（Electron/系统权限）；拒绝后点 🎙 会重试。
- 唤醒词识别是「切段 + 转写后匹配」，不是专用 KWS 模型：环境嘈杂或语速过快时可能漏检；说唤醒词后停顿约 0.7 秒效果最好。

## 实现

`client.js` 是浏览器半边：

1. `getUserMedia` + `AudioContext` + `ScriptProcessor` 常开采集，能量 VAD 切句（420ms 预卷、720ms 尾静音、12s 上限）。
2. 每句降采样到 16 kHz、编码 PCM16 WAV，经 `ctx.remote.speech.transcribe({ audioBase64, language: 'zh' })` 走 Host 的 SenseVoice。
3. 匹配唤醒词（`你好Fairy` 前缀模式，或单独 `Fairy`）；命中后清掉唤醒词，把指令通过官方输入框的 `inputActions.insertText(text, captureInsertion())` 写入并把 `inputActions.submit()` 交给发送队列（默认直接发送）。
4. 通过 `conversation.composer.dock` 插槽显示 🎙 状态标签，通过 `settings.section` 提供设置面板。

## English

Wake-word voice input for DeepSeek Harness: an always-on mic listens for **"你好Fairy"** or a bare **"Fairy"**, then transcribes the utterance with the official experimental voice-input bundle (SenseVoice, local CPU) and **sends it immediately** by default. It mounts a small status pill in the composer dock and a settings section. It is client-only, depends on the official voice-input bundle and its SenseVoice model; auto-send can be turned off in Settings → 语音唤醒.
