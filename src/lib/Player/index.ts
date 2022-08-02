export interface PlayerOptions {
    controls: boolean;
    autoplay: boolean;
    muted: boolean;
    live: boolean;
    debug: boolean;
}
export interface PlayerEvents {
    onInit?: (videoEl: HTMLVideoElement) => Promise<void>;
    _onParseManifest?: (manifest: any) => Promise<void>;
    _onLoadFirstSegment?: (firstSegment: any) => Promise<void>;
    _onLoadSegment?: (segment: any) => Promise<void>;
    onReady?: () => Promise<void>;
    onState?: (state: PlayerState, types: string[]) => Promise<void>;
    onError?: (err: any, type?: string) => Promise<void>;
}
export interface PlayerState {
    paused: boolean;
    seeking: boolean;
    beginLoadTime: number; // 开始加载的时间点
    loadDuration: number; // 加载完成的时长
    willLoadDuration: number; // 将要加载完成时长
    currentTime: number; // 当前播放时间点
    totalDuration: number; // 总时长
}

import muxjs from 'mux.js'
import * as m3u8Parser from 'm3u8-parser'

export class Player {
    videoEl: HTMLVideoElement;
    options: PlayerOptions;
    events: PlayerEvents;
    state: PlayerState;
    // mediaSource
    masterUrl?: URL;
    masterManifest?: any;
    mediaUrl?: URL;
    mediaManifest?: any;
    loadedSegments?: any[];
    downloadSegementInterval?: ReturnType<typeof setTimeout>;
    firstSegmentDataBufferAppendFinishCallback?: () => Promise<void>;
    mediaSource?: MediaSource;
    mediaSouceInitPromise?: Promise<void>;
    sourceBuffer?: SourceBuffer;
    // mux.js
    transmuxer: muxjs.mp4.Transmuxer;


    static isSupported (codecs = null) {
        //const mimeCodec = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
        //const mimeCodec = 'video/webm; codecs="opus, vp9"'
        return 'MediaSource' in window && (codecs ? MediaSource.isTypeSupported(codecs) : true)
        // other methods can use canPlayType
        // https://www.w3school.com.cn/tags/av_met_canplaytype.asp
    }

    constructor(videoEl: HTMLVideoElement, options: PlayerOptions, events?: PlayerEvents) {
        this.videoEl = videoEl
        this.options = options
        this.events = {
            ...events,
            onInit: async (videoEl: HTMLVideoElement) => {
                if (this.options.debug) { console.debug('onInit called', videoEl) }
                if (events.onInit) { await events.onInit(videoEl) }
            },
            _onParseManifest: async (manifest: any) => {
                if (this.options.debug) { console.debug('onParseManifest called', manifest) }
                if (events._onParseManifest) { await events._onParseManifest(manifest) }
            },
            _onLoadFirstSegment: async (firstSegment: any) => {
                if (this.options.debug) { console.debug('onLoadFirstSegment called', firstSegment) }
                if (events._onLoadFirstSegment) { await events._onLoadFirstSegment(firstSegment) }
            },
            _onLoadSegment: async (segment: any) => {
                if (this.options.debug) { console.debug('_onLoadSegment called', segment) }
                if (events._onLoadSegment) { await events._onLoadSegment(segment) }
            },
            onReady: async () => {
                if (this.options.debug) { console.debug('onReady called') }
                if (events.onReady) { await events.onReady() }
            },
            onState: async (state: PlayerState, types: string[]) => {
                if (this.options.debug) { console.debug('onState called', state, types) }
                if (events.onState) { await events.onState(state, types) }
            },
            onError: async (error: any, type?: string) => {
                if (this.options.debug) { console.debug('onError called', error) }
                if (events.onError) { await events.onError(error, type) }
            }
        }
        this.state = {
            paused: !this.options.autoplay,
            seeking: false,
            beginLoadTime: 0,
            loadDuration: 0,
            willLoadDuration: 0,
            currentTime: 0,
            totalDuration: 0,
        }
        this.videoEl.addEventListener('timeupdate', () => {
            if (!this.state.seeking) {
                Object.assign(this.state, { currentTime: videoEl.currentTime })
                this.events.onState(this.state, ['currentTime'])
            }
        })
        // if (this.options.controls) { this.videoEl.controls = true }
        if (this.options.muted) { this.videoEl.muted = true }
        if (this.options.autoplay) { this.videoEl.autoplay = true }
        this.transmuxer = new muxjs.mp4.Transmuxer({
            // remux选项默认为true，将源数据的音频视频混合为mp4，设为false则不混合
            remux: true,
        })
    }
    async setSrc(src: string) {
        console.assert(src, 'url must be exits')
        this.masterUrl = new URL(src)
        this.loadedSegments = []
        this.state = { paused: this.state.paused, seeking: false, beginLoadTime: 0, loadDuration: 0, willLoadDuration: 0, currentTime: 0, totalDuration: 0,}
        this.mediaSource = new MediaSource()
        this.firstSegmentDataBufferAppendFinishCallback = null
        const mediaSouceInitPromise: Promise<void> = new Promise((resolve) => {
            this.mediaSource.addEventListener('sourceopen', () => {
                if (this.mediaSouceInitPromise === mediaSouceInitPromise) {
                    if (this.sourceBuffer) { this.mediaSource.removeSourceBuffer(this.sourceBuffer) }
                    this.sourceBuffer = this.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')
                    this.sourceBuffer.mode = this.options.live ? 'sequence' : 'segments'
                    this.events.onInit(this.videoEl)
                }
                resolve()
            }, {once: true})
        })
        this.mediaSouceInitPromise = mediaSouceInitPromise
        this.videoEl.src = URL.createObjectURL(this.mediaSource)
        await this.mediaSouceInitPromise
        URL.revokeObjectURL(this.videoEl.src)
        await this.parseMasterWithFirstMediaUrl()
        if (this.mediaManifest.endList) {
            if (this.options.debug) { console.debug('segemnts定义获取完毕') }
        }
        this.intervalDownloadSegements()
    }
    async parseMasterWithFirstMediaUrl() {
        if (!this.masterManifest) {
            // https://zh.javascript.info/fetch-abort
            const abortController = new AbortController()
            const manifest = await this.fetchPlus(this.masterUrl.href, {signal: abortController.signal}, Number.MAX_VALUE).then(response => response.text())
            const parser = new m3u8Parser.Parser()
            parser.push(manifest)
            parser.end()
            this.events._onParseManifest(parser.manifest)
            this.masterManifest = parser.manifest

            if (this.masterManifest?.playlists?.length) {
                const meidaItem = this.masterManifest.playlists[0]
                this.mediaUrl = new URL(meidaItem.uri, this.masterUrl.href)
                await this.parseMediaUrl()
            } else {
                this.mediaUrl = this.masterUrl
                this.mediaManifest = this.masterManifest
                // 重新计算segment _startTimes
                let startTimestamp = 0
                for (const segment of this.mediaManifest.segments) {
                    segment._startTime = startTimestamp
                    startTimestamp += segment.duration
                }
            }
        }
    }
    async parseMediaUrl() {
        const abortController = new AbortController()
        const manifest = await this.fetchPlus(this.mediaUrl.href, {signal: abortController.signal}, Number.MAX_VALUE).then(response => response.text())
        const parser = new m3u8Parser.Parser()
        parser.push(manifest)
        parser.end()
        this.events._onParseManifest(parser.manifest)
        if (!this.mediaManifest) {
            this.mediaManifest = parser.manifest
        } else {
            for (const segment of parser.manifest.segments) {
                const exist = this.mediaManifest.segments.find(existsSegment => existsSegment.uri === segment.uri)
                if (!exist) {
                    this.mediaManifest.segments.push(segment)
                }
            }
        }
        // 重新计算segment _startTime
        let timestamp = 0
        for (const segment of this.mediaManifest.segments) {
            segment._startTime = timestamp
            timestamp += segment.duration
        }
        Object.assign(this.state, { totalDuration: timestamp })
        this.events.onState(this.state, ['totalDuration'])
    }
    async intervalDownloadSegements() {
        if (this.downloadSegementInterval) {
            clearInterval(this.downloadSegementInterval)
            this.downloadSegementInterval = null
        }
        await this.downloadSegments().finally(async () => {
            this.downloadSegementInterval = setTimeout(async () => {
                this.intervalDownloadSegements()
            }, 3000)
        })
    }
    async downloadSegments() {
        const loadedSegments = this.loadedSegments
        for (let idx in this.mediaManifest.segments) {
            const segment = this.mediaManifest.segments[idx]
            if (this.loadedSegments === loadedSegments && loadedSegments.indexOf(segment) === -1 && segment._startTime >= this.state.beginLoadTime) {
                Object.assign(this.state, { willLoadDuration: this.state.loadDuration + segment.duration })
                this.events.onState(this.state, ['willLoadDuration'])

                // const segmentUrl = new URL(segment.uri, this.mediaUrl.href)
                const dataBuffer = await this.fetchSegmentDataBuffer(segment)
                const appendDataBuffer = async (dataBuffer: Uint8Array) => {
                    return new Promise<void>(async (resolve, reject) => {
                        this.sourceBuffer.onupdateend = () => {
                            if (this.loadedSegments === loadedSegments) {
                                if (!loadedSegments.length) {
                                    if (this.firstSegmentDataBufferAppendFinishCallback) { this.firstSegmentDataBufferAppendFinishCallback() }
                                }
                                loadedSegments.push(segment)
                                if (this.mediaManifest.endList) {
                                    if (this.options.debug) { console.debug('load finished') }
                                    this.mediaSource.endOfStream()
                                }
                                Object.assign(this.state, { loadDuration: this.state.willLoadDuration })
                                this.events.onState(this.state, ['loadDuration'])
                                resolve()
                            } else {
                                reject()
                            }
                        }
                        this.transmuxer.off('data');
                        this.transmuxer.on('data', async (segment) => {
                            if (this.loadedSegments === loadedSegments) {
                                if (!loadedSegments.length) { // first append
                                    this.events._onLoadFirstSegment(segment)
                                    const data = new Uint8Array(segment.initSegment.byteLength + segment.data.byteLength);
                                    data.set(segment.initSegment, 0);
                                    data.set(segment.data, segment.initSegment.byteLength);
                                    // console.log(muxjs.mp4.tools.inspect(data));
                                    // if (!this.options.live) {
                                    //     // 先设定新chunk加入的位置，比如第x秒处
                                    //     this.sourceBuffer.timestampOffset = this.state.beginLoadTime
                                    // }
                                    this.sourceBuffer.appendBuffer(data)
                                    await this.events.onReady()
                                } else {
                                    this.sourceBuffer.appendBuffer(new Uint8Array(segment.data))
                                }
                            } else {
                                reject()
                            }
                        })
                        this.transmuxer.push(dataBuffer)
                        this.transmuxer.flush()
                    })
                }
                if (this.loadedSegments === loadedSegments) {
                    await appendDataBuffer(new Uint8Array(dataBuffer))
                }
            }
        }
    }
    async seekToTime(toTime: number) {
        if (this.state.seeking) { return }
        this.state.seeking = true
        toTime = Math.max(0, Math.min(this.state.totalDuration - 3, toTime))
        const isLoad = this.state.beginLoadTime <= toTime && this.state.beginLoadTime + this.state.loadDuration > toTime
        if (isLoad) {
            Object.assign(this.state, {currentTime: toTime})
            this.events.onState(this.state, ['currentTime'])
            this.videoEl.currentTime = toTime
            await new Promise(resolve => setTimeout(resolve, 500))
            this.state.seeking = false
        } else {
            // await new Promise(resolve => setTimeout(resolve, 500))
            this.loadedSegments = []
            const preState = {...this.state}
            for (const segment of this.mediaManifest.segments) {
                if (segment._abortController) {
                    try {
                        segment._abortController.abort()
                        segment._abortController = null
                    } catch (e) {
                        console.error(e)
                    }
                }
            }
            Object.assign(this.state, {loadDuration: 0, willLoadDuration: 0, currentTime: toTime,})
            this.events.onState(this.state, ['loadDuration', 'willLoadDuration', 'currentTime'])
            for (const segment of this.mediaManifest.segments) {
                if (segment._startTime <= toTime && segment._startTime + segment.duration > toTime) {
                    Object.assign(this.state, {beginLoadTime: segment._startTime})
                    this.events.onState(this.state, ['beginLoadTime'])
                    break
                }
            }
            // this.transmuxer = new muxjs.mp4.Transmuxer({ remux: true, })
            if (this.mediaSource.readyState === 'open') {
                this.sourceBuffer.abort()
                // if (preState.loadDuration) {
                //     this.sourceBuffer.remove(preState.beginLoadTime, preState.beginLoadTime + preState.loadDuration)
                // }
                this.transmuxer.setBaseMediaDecodeTime(this.state.beginLoadTime)
                this.sourceBuffer.timestampOffset = this.state.beginLoadTime
            }
            const firstSegmentDataBufferAppendFinishCallback = async () => {
                if (this.firstSegmentDataBufferAppendFinishCallback === firstSegmentDataBufferAppendFinishCallback) {
                    this.videoEl.currentTime = toTime
                    await new Promise(resolve => setTimeout(resolve, 100))
                    this.state.seeking = false
                }
            }
            this.firstSegmentDataBufferAppendFinishCallback = firstSegmentDataBufferAppendFinishCallback
            this.intervalDownloadSegements()
        }
    }
    async pause() {
        await this.videoEl.pause()
        Object.assign(this.state, { paused: true })
        this.events.onState(this.state, ['paused'])
    }
    async play() {
        await this.videoEl.play()
        Object.assign(this.state, { paused: false })
        this.events.onState(this.state, ['paused'])
    }
    destroy() {
        if (this.options.debug) { console.debug('player on destroy') }
    }
    async fetchSegmentDataBuffer(segment) {
        const segmentUrl = new URL(segment.uri, this.mediaUrl.href)
        const abortController = new AbortController()
        segment._abortController = abortController
        const res = await this.fetchPlus(segmentUrl.href, {signal: abortController.signal}, Number.MAX_VALUE)
        try {
            const dataBuffer = await res.arrayBuffer()
            return dataBuffer
        } catch (e) {
            return await this.fetchSegmentDataBuffer(segment)
        }
    }
    async fetchPlus(url: string, options: object, retries = 1) {
        try {
            const res = await fetch(url, options)
            if (res.ok) { return res }
            throw res
        } catch(err) {
            this.events.onError(err, 'fetch')
            if (err.name == 'AbortError') {
                throw err
            } else if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 3000))
                return this.fetchPlus(url, options, retries - 1)
            } else {
                throw err
            }
        }
    }
}

