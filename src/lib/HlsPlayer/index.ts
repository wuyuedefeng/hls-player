export interface PlayerOptions {
    controls: boolean;
    autoplay: boolean;
    muted: boolean;
    // live: boolean;
    debug: boolean;
    codecs: string;
}
export interface PlayerEvents {
    onInit?: (videoEl: HTMLVideoElement) => void;
    onParseManifest?: (manifest: any) => void;
    onLoadFirstSegment?: (firstSegment: any, inspectData: any) => void;
    onLoadSegment?: (segment: any) => void;
    onLoadSegmentDataBuffer?: (segment: any, arrayBuffer: ArrayBuffer) => Promise<ArrayBuffer | null | undefined>;
    onReady?: () => void;
    onState?: (state: PlayerState, types: string[]) => void;
    onError?: (err: any, type?: string) => void;
}
export interface PlayerState {
    paused: boolean;
    muted: boolean;
    volume: number; // 0 - 1
    seeking: boolean;
    beginLoadTime: number; // 开始加载的时间点
    endLoadTime: number; // 加载完成的时间点
    currentTime: number; // 当前播放时间点
    totalDuration: number; // 总时长
}

import muxjs from 'mux.js'
import * as m3u8Parser from 'm3u8-parser'

export class Player {
    private validVersion: number;
    videoEl: HTMLVideoElement;
    private options: PlayerOptions;
    private events: PlayerEvents;
    private state: PlayerState;
    // manifest
    private masterUrl?: URL;
    private masterManifest?: any;
    private mediaUrl?: URL;
    private mediaManifest?: any;
    private loadedSegments: any[];
    private partLastSegmentInfo?: { finished: boolean, segment: any, dataBuffer: any };
    private downloadSegmentsInterval?: ReturnType<typeof setTimeout>;
    private firstSegmentDataBufferAppendFinishCallback?: () => Promise<void>;
    // mediaSource
    private mediaSource: MediaSource;
    private sourceBuffer?: SourceBuffer;
    // mux.js
    private transmuxer?: muxjs.mp4.Transmuxer;

    static isSupported (codecs: string) {
        //const mimeCodec = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
        //const mimeCodec = 'video/mp4; codecs="avc1.64001E'
        //const mimeCodec = 'video/webm; codecs="opus, vp9"'
        return 'MediaSource' in window && (codecs ? MediaSource.isTypeSupported(codecs) : false)
        // other methods can use canPlayType
        // https://www.w3school.com.cn/tags/av_met_canplaytype.asp
    }

    constructor(videoEl: HTMLVideoElement, options: PlayerOptions, events?: PlayerEvents) {
        this.videoEl = videoEl
        this.options = options
        this.events = {
            ...events,
            onInit: (videoEl: HTMLVideoElement) => {
                if (this.options.debug) { console.debug('onInit called', videoEl) }
                if (events.onInit) { events.onInit(videoEl) }
            },
            onParseManifest: (manifest: any) => {
                if (this.options.debug) { console.debug('onParseManifest called', manifest) }
                if (events.onParseManifest) { events.onParseManifest(manifest) }
            },
            onLoadFirstSegment: (firstSegment: any, inspectData: any) => {
                if (this.options.debug) { console.debug('onLoadFirstSegment called', firstSegment) }
                if (events.onLoadFirstSegment) { events.onLoadFirstSegment(firstSegment, inspectData) }
            },
            onLoadSegment: (segment: any) => {
                if (this.options.debug) { console.debug('onLoadSegment called', segment) }
                if (events.onLoadSegment) { events.onLoadSegment(segment) }
            },
            onLoadSegmentDataBuffer: async (segment: any, dataBuffer: ArrayBuffer) => {
                if (this.options.debug) { console.debug('onLoadSegmentArrayBuffer called', segment) }
                if (events.onLoadSegmentDataBuffer) { return await events.onLoadSegmentDataBuffer(segment, dataBuffer) }
            },
            onReady: () => {
                if (this.options.debug) { console.debug('onReady called') }
                if (events.onReady) { events.onReady() }
            },
            onState: (state: PlayerState, types: string[]) => {
                if (this.options.debug) { console.debug('onState called', state, types) }
                if (events.onState) { events.onState(state, types) }
            },
            onError: (error: any, type?: string) => {
                if (this.options.debug) { console.debug('onError called', error) }
                if (events.onError) { events.onError(error, type) }
            }
        }
        this.state = { paused: !this.options.autoplay, muted: this.options.muted, volume: this.videoEl.volume, seeking: true, beginLoadTime: 0, endLoadTime: 0, currentTime: 0, totalDuration: 0, }
        this.events.onState(this.state, ['paused', 'muted', 'volume', 'seeking', 'beginLoadTime', 'endLoadTime', 'currentTime', 'totalDuration'])
        this.validVersion = 0;
        this.loadedSegments = []
        this.partLastSegmentInfo = null
        // this.mediaSource = new MediaSource()
        this.transmuxer = new muxjs.mp4.Transmuxer({
            remux: true, // remux选项默认为true，将源数据的音频视频混合为mp4，设为false则不混合
            baseMediaDecodeTime: 0,
            keepOriginalTimestamps: false,
        })
        if (this.options.controls) { this.videoEl.controls = true }
        if (this.options.muted) { this.videoEl.muted = true }
        if (this.options.autoplay) { this.videoEl.autoplay = true }
        this.videoEl.ontimeupdate = () => {
            const currentTime = this.videoEl.currentTime
            if (this.state.beginLoadTime <= currentTime && this.state.endLoadTime > currentTime) {
                if (this.partLastSegmentInfo?.finished && this.partLastSegmentInfo?.segment && !this.state.seeking && currentTime > this.partLastSegmentInfo.segment._startTime) {
                    return this.seekToTime(currentTime + 0.5, true)
                }
                Object.assign(this.state, {currentTime: this.videoEl.currentTime})
                this.events.onState(this.state, ['currentTime'])
            } else if (!this.state.seeking) {
                return this.seekToTime(currentTime)
            }
        }
        this.videoEl.onvolumechange = (event) => {
            Object.assign(this.state, {volume: this.videoEl.volume})
            this.events.onState(this.state, ['volume'])
        };
    }
    private setValidVersion(validVersion) {
        // this.transmuxer = new muxjs.mp4.Transmuxer({remux: true, baseMediaDecodeTime: 0})
        this.loadedSegments = []
        this.partLastSegmentInfo = null
        this.firstSegmentDataBufferAppendFinishCallback = null
        this.validVersion = validVersion
        return validVersion
    }
    async setSrc(src: string) {
        console.assert(src, 'url must be exits')
        this.validVersion = 0
        this.masterUrl = new URL(src)
        this.masterManifest = null
        this.mediaUrl = null
        this.mediaManifest = null

        this.state = { paused: !this.options.autoplay, muted: this.options.muted, volume: this.videoEl.volume, seeking: true, beginLoadTime: 0, endLoadTime: 0, currentTime: 0, totalDuration: 0, }
        this.events.onState(this.state, ['paused', 'muted', 'volume', 'seeking', 'beginLoadTime', 'endLoadTime', 'currentTime', 'totalDuration'])

        if (this.mediaSource?.readyState === 'open') {
            this.mediaSource.endOfStream()
            this.mediaSource = null
        }
        this.mediaSource = new MediaSource()
        const mediaSourceInitPromise: Promise<void> = new Promise<void>((resolve, reject) => {
            this.mediaSource.addEventListener('sourceopen', () => {
                if (Player.isSupported(this.options.codecs)) {
                    this.sourceBuffer = this.mediaSource.addSourceBuffer(this.options.codecs)
                } else {
                    reject(new Error(`not support codecs: ${this.options.codecs}`))
                }

                // this.sourceBuffer.mode = this.options.live ? 'sequence' : 'segments'
                this.sourceBuffer.mode = 'segments'
                this.events.onInit(this.videoEl)
                resolve()
            }, {once: true})
        })
        this.videoEl.src = URL.createObjectURL(this.mediaSource)
        await mediaSourceInitPromise
        URL.revokeObjectURL(this.videoEl.src)

        // this.setValidVersion(this.validVersion + 1)
        await this.parseVersionMasterWithFirstMediaUrl(this.validVersion)
        if (this.mediaManifest.endList) {
            if (this.options.debug) { console.debug('segments定义获取完毕') }
            if (this.mediaManifest.segments.length === 0) {
                if (this.options.debug) { console.debug('segments为空, 播放结束') }
                return this.mediaSource.endOfStream()
            }
        }
        this.mediaSource.duration = this.state.totalDuration
        this.mediaSource.setLiveSeekableRange(0, this.state.totalDuration)
        await this.seekToTime(0)
    }
    private async parseVersionMasterWithFirstMediaUrl(validVersion: number) {
        if (!this.masterManifest) {
            // https://zh.javascript.info/fetch-abort
            const abortController = new AbortController()
            const manifest = await this.fetchPlus(this.masterUrl.href, {signal: abortController.signal}, Number.MAX_VALUE).then(response => response.text())
            if (this.validVersion === validVersion) {
                const parser = new m3u8Parser.Parser()
                parser.push(manifest)
                parser.end()
                this.events.onParseManifest(parser.manifest)
                this.masterManifest = parser.manifest

                if (this.masterManifest?.playlists?.length) {
                    const mediaItem = this.masterManifest.playlists[0]
                    this.mediaUrl = new URL(mediaItem.uri, this.masterUrl.href)
                    await this.parseVersionMediaUrl(validVersion)
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
    }
    private async parseVersionMediaUrl(validVersion: number) {
        const abortController = new AbortController()
        const manifest = await this.fetchPlus(this.mediaUrl.href, {signal: abortController.signal}, Number.MAX_VALUE, validVersion).then(response => response.text())
        if (this.validVersion === validVersion) {
            const parser = new m3u8Parser.Parser()
            parser.push(manifest)
            parser.end()
            this.events.onParseManifest(parser.manifest)
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
            if (this.mediaSource.duration !== this.state.totalDuration) {
                this.mediaSource.duration = this.state.totalDuration
                this.mediaSource.clearLiveSeekableRange()
                this.mediaSource.setLiveSeekableRange(0, this.state.totalDuration)
            }
        }
    }
    private async intervalDownloadVersionSegments(validVersion: number) {
        if (this.downloadSegmentsInterval) {
            clearInterval(this.downloadSegmentsInterval)
            this.downloadSegmentsInterval = null
        }
        await this.downloadVersionSegments(validVersion).then(async () => {
            if (this.validVersion === validVersion/* && this.options.live*/ && !this.mediaManifest.endList) {
                await this.parseVersionMediaUrl(validVersion)
            }
        }).finally(async () => {
            if (this.validVersion === validVersion) {
                this.downloadSegmentsInterval = setTimeout(() => {
                    if (this.validVersion === validVersion && this.mediaSource.readyState === 'open') {
                        this.intervalDownloadVersionSegments(validVersion)
                    }
                }, 3000)
            }
        })
    }
    private async downloadVersionSegments(validVersion: number) {
        const loadedSegments = this.loadedSegments
        const transmuxer = this.transmuxer
        for (let idx in this.mediaManifest.segments) {
            const segment = this.mediaManifest.segments[idx]
            if (this.validVersion === validVersion && this.loadedSegments === loadedSegments && loadedSegments.indexOf(segment) === -1 && segment._startTime >= this.state.endLoadTime && !this.partLastSegmentInfo?.finished) {
                if (segment._startTime < this.state.currentTime + 60 || this.state.endLoadTime - this.state.beginLoadTime > 150) { // 最多提前缓存当前播放时间点的前60s, 或者总缓存时间超过150s
                    // const segmentUrl = new URL(segment.uri, this.mediaUrl.href)
                    let dataBuffer = null
                    if (this.partLastSegmentInfo?.segment === segment && this.partLastSegmentInfo?.dataBuffer) {
                        dataBuffer = this.partLastSegmentInfo.dataBuffer
                    } else {
                        dataBuffer = await this.fetchVersionSegmentDataBuffer(validVersion, segment)
                        dataBuffer = await this.events.onLoadSegmentDataBuffer(segment, dataBuffer) || dataBuffer
                    }
                    const appendDataBuffer = async (dataBuffer: Uint8Array) => {
                        return new Promise<void>(async (resolve, reject) => {
                            this.sourceBuffer.onupdateend = () => {
                                if (this.validVersion === validVersion) {
                                    // if (this.options.debug) {
                                    //     const buffered = this.sourceBuffer.buffered
                                    //     console.debug('loaded time computed from buffer', buffered.start(0), buffered.end(0), buffered.length)
                                    // }
                                    if (!this.loadedSegments.length) { // first append
                                        if (this.firstSegmentDataBufferAppendFinishCallback) { this.firstSegmentDataBufferAppendFinishCallback() }
                                    }
                                    loadedSegments.push(segment)
                                    if (this.mediaManifest.endList && Number(idx) === this.mediaManifest.segments.length - 1) {
                                        if (this.options.debug) { console.debug('load finished') }
                                        this.mediaSource.endOfStream()
                                    }
                                    Object.assign(this.state, {endLoadTime: this.state.endLoadTime + segment.duration })
                                    this.events.onState(this.state, ['endLoadTime'])
                                    this.partLastSegmentInfo = {finished: false, segment: segment, dataBuffer: dataBuffer}
                                }
                                return resolve()
                            }
                            transmuxer.off('data')
                            transmuxer.on('data', async (segment) => {
                                if (this.validVersion === validVersion) {
                                    if (!loadedSegments.length) { // first append
                                        const data = new Uint8Array(segment.initSegment.byteLength + segment.data.byteLength);
                                        data.set(segment.initSegment, 0);
                                        data.set(segment.data, segment.initSegment.byteLength);
                                        // console.log(muxjs.mp4.tools.inspect(data));
                                        // if (!this.options.live) {
                                        //     // 先设定新chunk加入的位置，比如第x秒处
                                        //     this.sourceBuffer.timestampOffset = this.state.beginLoadTime
                                        // }
                                        this.sourceBuffer.appendBuffer(data)
                                        this.events.onLoadFirstSegment(segment, muxjs.mp4.tools.inspect(data))
                                        this.events.onLoadSegment(segment)
                                        await this.events.onReady()
                                    } else {
                                        this.sourceBuffer.appendBuffer(new Uint8Array(segment.data))
                                        this.events.onLoadSegment(segment)
                                    }
                                } else {
                                    reject()
                                }
                            })
                            transmuxer.push(new Uint8Array(dataBuffer))
                            transmuxer.flush()
                        })
                    }
                    if (this.validVersion === validVersion) {
                        await appendDataBuffer(new Uint8Array(dataBuffer))
                    }
                } else {
                    if (this.partLastSegmentInfo) {
                        this.partLastSegmentInfo = {...this.partLastSegmentInfo, finished: true}
                    }
                    break
                }
            }
        }
    }
    private async fetchVersionSegmentDataBuffer(validVersion: number, segment: any) {
        const segmentUrl = new URL(segment.uri, this.mediaUrl.href)
        const abortController = new AbortController()
        segment._abortController = abortController
        const res = await this.fetchPlus(segmentUrl.href, {signal: abortController.signal}, Number.MAX_VALUE, validVersion)
        segment._abortController = null
        try {
            const dataBuffer = await res.arrayBuffer()
            return dataBuffer
        } catch (e) {
            if (this.validVersion === validVersion) {
                return await this.fetchVersionSegmentDataBuffer(validVersion, segment)
            }
            throw e
        }
    }
    async fetchPlus(url: string, options: object, retries?: number, validVersion?: number) {
        try {
            const res = await fetch(url,{cache: 'no-cache', ...options})
            if (res.ok) { return res }
            throw res
        } catch(err) {
            this.events.onError(err, 'fetch')
            if (err.name == 'AbortError' || (validVersion && this.validVersion !== validVersion)) {
                throw err
            } else if (retries && retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 3000))
                return this.fetchPlus(url, options, retries - 1, validVersion)
            } else {
                throw err
            }
        }
    }
    async seekToTime(toTime: number, forceReload = false) {
        this.state.seeking = true
        toTime = Math.max(0, Math.min(this.state.totalDuration - 1, toTime))
        this.videoEl.currentTime = toTime
        const isLoad = this.state.beginLoadTime <= toTime && this.state.endLoadTime > toTime
        if (isLoad && !forceReload) {
            Object.assign(this.state, {currentTime: toTime})
            this.events.onState(this.state, ['currentTime'])
            // await new Promise(resolve => setTimeout(resolve, 500))
            this.state.seeking = false
        } else {
            // const preState = {...this.state}
            const validVersion = this.setValidVersion(this.validVersion + 1)
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
            Object.assign(this.state, {currentTime: toTime})
            this.events.onState(this.state, ['currentTime'])
            for (const segment of this.mediaManifest.segments) {
                if (segment._startTime <= toTime && segment._startTime + segment.duration > toTime) {
                    const beginLoadTime = segment._startTime
                    Object.assign(this.state, {beginLoadTime, endLoadTime: beginLoadTime});
                    this.events.onState(this.state, ['beginLoadTime'])
                    break
                }
            }
            if (this.mediaSource.readyState === 'open') {
                this.sourceBuffer.abort() // Aborts the current segment and resets the segment parser
                this.transmuxer.setBaseMediaDecodeTime(this.state.beginLoadTime)
                this.sourceBuffer.timestampOffset = this.state.beginLoadTime
            } else if (this.mediaSource.readyState === 'ended') { // https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/changeType
                await new Promise<void>((resolve) => {
                    if (Player.isSupported(this.options.codecs)) {
                        this.sourceBuffer.changeType(this.options.codecs)
                    }
                    this.mediaSource.addEventListener('sourceopen', () => {
                        resolve()
                    }, {once: true})
                })
            }
            const firstSegmentDataBufferAppendFinishCallback = async () => {
                this.videoEl.currentTime = this.state.currentTime
                // await new Promise(resolve => setTimeout(resolve, 500))
                if (this.validVersion === validVersion) {
                    // if (!this.state.paused) { await this.play() }
                    this.state.seeking = false
                }
            }
            this.firstSegmentDataBufferAppendFinishCallback = firstSegmentDataBufferAppendFinishCallback
            this.intervalDownloadVersionSegments(this.validVersion)
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
        this.setValidVersion(this.validVersion + 1)
        if (this.mediaSource?.readyState === 'open') {
            this.sourceBuffer.abort()
        }
    }
}