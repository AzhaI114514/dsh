/* dsh-fairy-wake - client half.
 *
 * 常开麦克风监听唤醒词（默认「你好Fairy」）。听到唤醒词后开始采集下一句，
 * 用官方实验性语音输入 Bundle 的 SenseVoice 本地识别服务转写，然后把文字
 * 插入当前会话输入框；可选自动发送。
 *
 * 依赖（profile bundles 里已启用）：
 *   @deepseek-ai/dsh-experimental-voice-input-bundle
 *     -> @deepseek-ai/dsh-experimental-api-speech-to-text  (ctx.remote.speech)
 *     -> @deepseek-ai/dsh-experimental-speech-to-text-sensevoice
 */
window.__ModuleLoader__.load({
  id: 'dsh-fairy-wake',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const PKG = 'dsh-fairy-wake'
    const STORE_KEY = 'fairy.wake.v2'
    const DEFAULTS = { enabled: true, autoSend: true, wakePhrase: '你好fairy' }

    /* ------------------------------------------------------------------ *
     * 设置（localStorage）
     * ------------------------------------------------------------------ */
    function readSettings() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw) || {})
      } catch {}
      return Object.assign({}, DEFAULTS)
    }

    let settings = readSettings()
    const settingsListeners = new Set()

    function saveSettings(patch) {
      settings = Object.assign({}, settings, patch || {})
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(settings))
      } catch {}
      for (const listener of settingsListeners) {
        try {
          listener(settings)
        } catch {}
      }
    }

    function useSettings() {
      const [snapshot, setSnapshot] = useState(settings)
      useEffect(() => {
        const listener = (next) => setSnapshot(next)
        settingsListeners.add(listener)
        setSnapshot(settings)
        return () => {
          settingsListeners.delete(listener)
        }
      }, [])
      return snapshot
    }

    /* ------------------------------------------------------------------ *
     * 唤醒词匹配
     * ------------------------------------------------------------------ */
    const GREETINGS = ['你好', '您好', '嗨', '嘿', '哈喽', 'hello', 'hi']
    const GREETING_SOURCE = '你好|您好|嗨|嘿|哈喽|hello|hi'
    // SenseVoice 对「fairy」的转写很飘：fairy / fary / fry / 法瑞 / 菲瑞 … 都可能出现
    const ALIASES = [
      'fairy',
      'fary',
      'fairi',
      'fairly',
      'ferry',
      'fry',
      'fri',
      'frei',
      'feri',
      'feiri',
      'fari',
      'faeri',
      'fare',
      'fey',
      'fai',
      'fei',
      'fii',
      'firi',
      '菲瑞',
      '法瑞',
      '法里',
      '飞瑞',
      '费瑞',
      '发瑞',
      '法丽',
      '菲丽',
      '飞丽',
      '菲莉',
      '法莉',
      '绯瑞',
      '琲瑞',
      '法伊',
      '菲伊',
      '飞伊',
      '费伊',
      '法依',
      '菲依',
      '咖啡瑞',
    ]
    const TAIL_SOURCE = 'f[a-z]{1,10}|[菲法飞费发绯琲][瑞里丽莉利伊依]?'
    const ALIAS_SOURCE = ALIASES.join('|')

    function normalize(value) {
      return String(value == null ? '' : value)
        .replace(/[\s,，。．.!！?？、:：;；'"“”‘’()（）\[\]【】{}<>《》\-—~·…]/g, '')
        .toLowerCase()
    }

    function wakePattern() {
      return new RegExp('(?:' + GREETING_SOURCE + ')[\\s,，。.!！?？、:：;；]*(?:' + TAIL_SOURCE + ')', 'i')
    }

    /** 第二唤醒词：单独说「Fairy」（以及 SenseVoice 常见的转写变体）。 */
    function standaloneWake(text) {
      const raw = String(text == null ? '' : text)
        .trim()
        .replace(/^[\s,，。.!！?？、:：;；'"“”‘’()（）\-—]+/, '')
      if (!raw) return false
      return new RegExp('^(?:' + ALIAS_SOURCE + ')(?![a-z])', 'i').test(raw)
    }

    function detectWake(text) {
      const raw = String(text == null ? '' : text)
      if (!raw.trim()) return false
      if (wakePattern().test(raw)) return true
      if (standaloneWake(raw)) return true
      const norm = normalize(raw)
      const phrase = normalize(settings.wakePhrase || '')
      if (phrase && norm.includes(phrase)) return true
      for (const greeting of GREETINGS) {
        for (const alias of ALIASES) {
          if (norm.includes(normalize(greeting + alias))) return true
        }
      }
      return false
    }

    /** 去掉开头的唤醒词，返回剩下的指令；没有唤醒词开头则原样返回。 */
    function stripWake(text) {
      const rest = String(text == null ? '' : text).trim()
      if (!rest) return ''
      const lead = rest.match(new RegExp('^(?:' + GREETING_SOURCE + ')[\\s,，。.!！?？、:：;；]*', 'i'))
      if (lead) {
        const tail = rest.slice(lead[0].length)
        const alias = tail.match(new RegExp('^(?:' + TAIL_SOURCE + ')[\\s,，。.!！?？、:：;；]*', 'i'))
        if (alias) return tail.slice(alias[0].length).trim()
      }
      const solo = rest.match(new RegExp('^(?:' + ALIAS_SOURCE + ')(?![a-z])[\\s,，。.!！?？、:：;；]*', 'i'))
      if (solo) return rest.slice(solo[0].length).trim()
      const phrase = String(settings.wakePhrase || '')
      if (phrase && rest.toLowerCase().startsWith(phrase.toLowerCase())) {
        return rest
          .slice(phrase.length)
          .replace(/^[\s,，。.!！?？、:：;；]+/, '')
          .trim()
      }
      return rest
    }

    /* ------------------------------------------------------------------ *
     * WAV / 音频工具（与官方语音输入插件同一格式：16k mono PCM16）
     * ------------------------------------------------------------------ */
    function resample(samples, fromRate, toRate) {
      const rate = fromRate || 48000
      if (!samples || samples.length === 0) return new Float32Array(0)
      if (rate === toRate) return samples
      const ratio = rate / toRate
      const length = Math.max(1, Math.floor(samples.length / ratio))
      const output = new Float32Array(length)
      for (let i = 0; i < length; i += 1) {
        const position = i * ratio
        const index = Math.floor(position)
        const next = Math.min(samples.length - 1, index + 1)
        const mix = position - index
        output[i] = samples[index] * (1 - mix) + samples[next] * mix
      }
      return output
    }

    function encodeWav(samples) {
      const length = samples.length
      const bytes = new Uint8Array(44 + length * 2)
      const view = new DataView(bytes.buffer)
      const text = (offset, value) => {
        for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i)
      }
      text(0, 'RIFF')
      view.setUint32(4, bytes.length - 8, true)
      text(8, 'WAVE')
      text(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, 16000, true)
      view.setUint32(28, 32000, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      text(36, 'data')
      view.setUint32(40, length * 2, true)
      for (let i = 0; i < length; i += 1) {
        const value = Math.max(-1, Math.min(1, samples[i]))
        view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      }
      return bytes
    }

    function toBase64(bytes) {
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
      }
      return window.btoa(binary)
    }

    function beep(ac) {
      try {
        const osc = ac.createOscillator()
        const gain = ac.createGain()
        osc.type = 'sine'
        osc.frequency.value = 988
        gain.gain.value = 0.0001
        osc.connect(gain)
        gain.connect(ac.destination)
        const now = ac.currentTime
        gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
        osc.start(now)
        osc.stop(now + 0.18)
      } catch {}
    }

    /* ------------------------------------------------------------------ *
     * 监听引擎：能量 VAD + 分段转写
     * ------------------------------------------------------------------ */
    async function startListening(options) {
      const transcribe = options.transcribe
      const onStatus = options.onStatus
      const onCommand = options.onCommand

      const media = await window.navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext
      if (!AudioContextCtor) throw new Error('当前环境不支持 Web Audio')
      const ac = new AudioContextCtor()
      try {
        await ac.resume()
      } catch {}
      if (ac.state === 'suspended') {
        const resume = () => {
          try {
            ac.resume()
          } catch {}
        }
        window.addEventListener('pointerdown', resume, { passive: true })
        window.addEventListener('keydown', resume, { passive: true })
      }
      const source = ac.createMediaStreamSource(media)
      const processor = ac.createScriptProcessor(2048, 1, 1)
      const mute = ac.createGain()
      mute.gain.value = 0
      source.connect(processor)
      processor.connect(mute)
      mute.connect(ac.destination)

      const frameMs = (2048 / (ac.sampleRate || 48000)) * 1000
      let stopped = false
      let speech = false
      let silence = 0
      let voiced = 0
      let segment = []
      let preRoll = []
      let noise = 0.008
      let awakeUntil = 0
      let busy = false

      const rmsOf = (samples) => {
        let sum = 0
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
        return Math.sqrt(sum / samples.length)
      }
      const concat = (chunks) => {
        let length = 0
        for (const chunk of chunks) length += chunk.length
        const output = new Float32Array(length)
        let offset = 0
        for (const chunk of chunks) {
          output.set(chunk, offset)
          offset += chunk.length
        }
        return output
      }

      async function handleSegment(samples) {
        if (busy || stopped) return
        busy = true
        try {
          onStatus('thinking')
          const wav = encodeWav(resample(samples, ac.sampleRate, 16000))
          const result = await transcribe({ audioBase64: toBase64(wav), language: 'zh' })
          if (stopped) return
          if (!result || result.ok === false) {
            const message = (result && result.error && (result.error.message || result.error.code)) || '语音识别失败'
            throw new Error(message)
          }
          const text = String((result.value && result.value.text) || '').trim()
          if (!text) {
            onStatus('listening')
            return
          }
          const awaitingCommand = awakeUntil && Date.now() < awakeUntil
          if (awaitingCommand) {
            awakeUntil = 0
            const command = stripWake(text)
            if (command) onCommand(command)
            onStatus('listening')
            return
          }
          if (detectWake(text)) {
            const command = stripWake(text)
            beep(ac)
            if (command && command.length >= 2) {
              awakeUntil = 0
              onCommand(command)
              onStatus('listening')
            } else {
              awakeUntil = Date.now() + 9000
              onStatus('awake')
            }
            return
          }
          onStatus('listening')
        } catch (cause) {
          if (stopped) return
          try {
            console.warn('[fairy-wake] 识别失败', cause)
          } catch {}
          onStatus('error')
          window.setTimeout(() => {
            if (!stopped) onStatus('listening')
          }, 3000)
        } finally {
          busy = false
        }
      }

      processor.onaudioprocess = (event) => {
        if (stopped) return
        const input = event.inputBuffer.getChannelData(0)
        const frame = new Float32Array(input.length)
        frame.set(input)
        const rms = rmsOf(frame)
        const threshold = Math.max(0.012, noise * 2.8)
        if (!speech) {
          noise = noise * 0.97 + Math.min(rms, 0.05) * 0.03
          preRoll.push(frame)
          const keep = Math.ceil(420 / frameMs)
          while (preRoll.length > keep) preRoll.shift()
          if (rms > threshold) {
            speech = true
            silence = 0
            voiced = frameMs
            segment = preRoll.slice()
            preRoll = []
            onStatus('hearing')
          }
          return
        }
        segment.push(frame)
        if (rms > threshold) {
          voiced += frameMs
          silence = 0
        } else {
          silence += frameMs
        }
        if ((silence >= 720 && voiced >= 240) || voiced + silence >= 12000) {
          const samples = concat(segment)
          segment = []
          speech = false
          silence = 0
          voiced = 0
          void handleSegment(samples)
        }
      }

      onStatus('listening')

      return function stop() {
        stopped = true
        try {
          processor.disconnect()
        } catch {}
        try {
          source.disconnect()
        } catch {}
        try {
          mute.disconnect()
        } catch {}
        try {
          media.getTracks().forEach((track) => track.stop())
        } catch {}
        try {
          ac.close()
        } catch {}
      }
    }

    /* ------------------------------------------------------------------ *
     * UI
     * ------------------------------------------------------------------ */
    const STATUS_LABELS = {
      off: '语音唤醒已关',
      preparing: '准备语音模型…',
      starting: '启动麦克风…',
      listening: '说「你好Fairy」或「Fairy」',
      hearing: '在听…',
      awake: '请说指令…',
      thinking: '识别中…',
      error: '唤醒出错，点我重试',
    }

    const CSS = `
.fw-dock{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-subtle,rgba(120,160,220,.28));background:var(--dsw-alias-bg-elevated,rgba(16,24,40,.55));color:var(--dsw-alias-text-secondary,#9fb6d4);font:inherit;font-size:12px;line-height:1;cursor:pointer;user-select:none;white-space:nowrap}
.fw-dock:hover{color:var(--dsw-alias-text-primary,#e6f2ff);border-color:var(--dsw-alias-border-strong,rgba(126,196,240,.55))}
.fw-dot{width:7px;height:7px;border-radius:50%;background:#5a6b82;flex:none;box-shadow:0 0 0 0 rgba(126,196,240,.0);transition:background .2s,box-shadow .2s}
.fw-listening .fw-dot,.fw-hearing .fw-dot{background:#59d38a;box-shadow:0 0 10px rgba(89,211,138,.8)}
.fw-hearing .fw-dot,.fw-awake .fw-dot{background:#7ec4f0;box-shadow:0 0 12px rgba(126,196,240,.9)}
.fw-thinking .fw-dot{background:#e7c46a;box-shadow:0 0 10px rgba(231,196,106,.8)}
.fw-preparing .fw-dot,.fw-starting .fw-dot{background:#e7c46a}
.fw-error .fw-dot{background:#e06a6a}
.fw-settings{display:flex;flex-direction:column;gap:10px;font-size:13px}
.fw-settings-title{font-weight:600}
.fw-settings-desc,.fw-settings-hint{color:var(--dsw-alias-text-secondary,#8fa3bd);font-size:12px;line-height:1.6}
.fw-settings-row{display:flex;align-items:center;gap:10px}
.fw-settings-row input[type=text]{flex:1;min-width:160px;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-subtle,rgba(120,160,220,.3));background:var(--dsw-alias-bg-base,transparent);color:inherit}
`

    function WakeDock(props) {
      const speech = props && props.fairyWakeSpeech
      const inputActions = props && props.inputActions
      const state = useSettings()
      const [status, setStatus] = useState('off')
      const inputRef = useRef(inputActions)
      inputRef.current = inputActions
      const stateRef = useRef(state)
      stateRef.current = state

      const deliver = (text) => {
        const clean = String(text == null ? '' : text).trim()
        if (!clean) return
        const input = inputRef.current
        try {
          if (input && typeof input.captureInsertion === 'function' && typeof input.insertText === 'function') {
            const span = input.captureInsertion()
            const inserted = input.insertText(clean, span)
            if (inserted && stateRef.current.autoSend && typeof input.submit === 'function') {
              window.setTimeout(() => {
                try {
                  input.submit()
                } catch {}
              }, 260)
            }
            return
          }
        } catch (cause) {
          try {
            console.warn('[fairy-wake] insertText 失败', cause)
          } catch {}
        }
        const editor = document.querySelector('[contenteditable="true"]')
        if (!editor) return
        try {
          editor.focus()
          document.execCommand('insertText', false, clean)
        } catch {}
        if (stateRef.current.autoSend) {
          window.setTimeout(() => {
            const button = document.querySelector('button[aria-label*="发送"], button[aria-label*="Send"]')
            if (button) button.click()
          }, 260)
        }
      }

      useEffect(() => {
        if (!state.enabled) {
          setStatus('off')
          return
        }
        if (!speech || typeof speech.transcribe !== 'function') {
          setStatus('error')
          return
        }
        let disposed = false
        let stop = null
        ;(async () => {
          try {
            setStatus('preparing')
            if (speech && typeof speech.prepare === 'function') {
              try {
                await speech.prepare('sensevoice-local')
              } catch (cause) {
                try {
                  console.warn('[fairy-wake] 语音模型准备失败（先在输入框点一次麦克风完成安装即可）', cause)
                } catch {}
                if (!disposed) setStatus('error')
                return
              }
            }
            if (disposed) return
            setStatus('starting')
            stop = await startListening({
              transcribe: (request, signal) => speech.transcribe(request, signal),
              onStatus: (next) => {
                if (!disposed) setStatus(next)
              },
              onCommand: deliver,
            })
          } catch (cause) {
            try {
              console.warn('[fairy-wake] 麦克风启动失败', cause)
            } catch {}
            if (!disposed) setStatus('error')
          }
        })()
        return () => {
          disposed = true
          if (stop) {
            try {
              stop()
            } catch {}
          }
        }
      }, [state.enabled, speech])

      const label = STATUS_LABELS[status] || STATUS_LABELS.off
      return h(
        'button',
        {
          type: 'button',
          className: 'fw-dock fw-' + status,
          title:
            'Fairy 语音唤醒：说「' + (state.wakePhrase || DEFAULTS.wakePhrase) + '」或直接说「Fairy」后开始听写' +
            (state.autoSend ? '（识别后直接发送）' : '（识别后插入输入框）'),
          onClick: () => {
            if (status === 'error') {
              saveSettings({ enabled: false })
              window.setTimeout(() => saveSettings({ enabled: true }), 80)
              return
            }
            saveSettings({ enabled: !state.enabled })
          },
        },
        h('span', { className: 'fw-dot' }),
        h('span', { className: 'fw-label' }, '🎙 ' + label),
      )
    }

    function WakeSettings() {
      const state = useSettings()
      return h(
        'div',
        { className: 'fw-settings' },
        h('div', { className: 'fw-settings-title' }, '语音唤醒（Fairy）'),
        h(
          'div',
          { className: 'fw-settings-desc' },
          '常开麦克风监听唤醒词：说「你好Fairy」或直接说「Fairy」，听到后开始听写，识别完直接把指令发送出去。识别使用官方实验性语音输入 Bundle 的 SenseVoice 本地模型。',
        ),
        h(
          'label',
          { className: 'fw-settings-row' },
          h('input', {
            type: 'checkbox',
            checked: Boolean(state.enabled),
            onChange: (event) => saveSettings({ enabled: event.target.checked }),
          }),
          '启用唤醒词监听',
        ),
        h(
          'label',
          { className: 'fw-settings-row' },
          h('input', {
            type: 'checkbox',
            checked: Boolean(state.autoSend),
            onChange: (event) => saveSettings({ autoSend: event.target.checked }),
          }),
          '识别后直接发送（默认开启）',
        ),
        h(
          'label',
          { className: 'fw-settings-row' },
          '唤醒词',
          h('input', {
            type: 'text',
            value: state.wakePhrase || DEFAULTS.wakePhrase,
            onChange: (event) => saveSettings({ wakePhrase: event.target.value }),
          }),
        ),
        h(
          'div',
          { className: 'fw-settings-hint' },
          '第二唤醒词固定为「Fairy」（含 fry / 法瑞 / 菲瑞 等转写变体）。首次启用会自动准备 SenseVoice 模型（约 239 MB，走 HF-Mirror）；状态显示在输入框下方的 🎙 标签上。',
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * 挂载
     * ------------------------------------------------------------------ */
    function installStyles(ctx) {
      if (typeof document === 'undefined') return
      const id = PKG + '/style.css'
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(id) + ']')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = PKG
      tag.dataset.pluginCss = id
      tag.textContent = CSS
      document.head.appendChild(tag)
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          try {
            tag.remove()
          } catch {}
        })
      }
    }

    function makeSpeechApi(ctx) {
      const getSpeech = () => (ctx.remote && ctx.remote.speech) || null
      return {
        transcribe: async (request, signal) => {
          const speech = getSpeech()
          if (!speech) throw new Error('语音识别服务未就绪（需要启用官方语音输入 Bundle）')
          return speech.transcribe(request, signal)
        },
        prepare: async (providerId) => {
          const speech = getSpeech()
          if (!speech) throw new Error('语音识别服务未就绪（需要启用官方语音输入 Bundle）')
          const result = await speech.prepare(providerId, undefined)
          if (result && result.ok === false) throw (result.error || new Error('语音模型准备失败'))
          return result
        },
      }
    }

    return {
      inject: ['remote', 'remote.speech', 'slots'],
      apply(ctx) {
        installStyles(ctx)
        const speechApi = makeSpeechApi(ctx)
        const mount = (name, spec, component, inject) => {
          try {
            ctx.slots.inject(name, function* () {
              try {
                const row = Object.assign({ name }, spec)
                if (inject) row.inject = inject
                yield ctx.slots.register(row, component)
              } catch (cause) {
                try {
                  console.warn('[fairy-wake] 注册 ' + name + ' 失败', cause)
                } catch {}
              }
            })
          } catch (cause) {
            try {
              console.warn('[fairy-wake] 注入 ' + name + ' 失败', cause)
            } catch {}
          }
        }
        mount(
          'conversation.composer.dock',
          { id: 'fairy-wake-dock', order: 30 },
          WakeDock,
          () => ({ fairyWakeSpeech: speechApi }),
        )
        mount('settings.section', { id: 'fairy-wake-settings', order: 42, label: '语音唤醒' }, WakeSettings)
      },
    }
  },
})
