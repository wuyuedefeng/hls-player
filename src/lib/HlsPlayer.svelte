<script lang="ts">
    // https://www.sveltejs.cn/tutorial/basics
    import {createEventDispatcher, onMount, onDestroy} from 'svelte'
    import type {PlayerState, PlayerOptions, PlayerEvents} from './HlsPlayer/index'
    import {Player} from './HlsPlayer/index'

    export let src: string = '';
    export let options: any = {};
    export let events: PlayerEvents = {};

    const dispatch = createEventDispatcher();

    let videoEl;
    let player = null;
    let playerState = null;

    let oldSrc = '';
    $: if (src !== oldSrc) {
        if (src) { player && player.setSrc(src) }
        oldSrc = src
    }
    $: loading = !!playerState?.seeking

    // const preMinute = () => {
    //     if (playerState) {
    //         player.seekToTime(playerState.currentTime - 60)
    //     }
    // }
    // const nextMinute = () => {
    //     if (playerState) {
    //         player.seekToTime(playerState.currentTime + 60)
    //     }
    // }

    onMount(() => {
        const mountEvent = new CustomEvent('beforeMount', {
            detail: {video: videoEl,},
            bubbles: true, cancelable: true,
            composed: true // makes the event jump shadow DOM boundary
        })
        videoEl.dispatchEvent(mountEvent)
        // disable contextmenu
        // if (videoEl.addEventListener) { videoEl.addEventListener('contextmenu', (event) => event.preventDefault() ) }
        // else { videoEl['attachEvent']('oncontextmenu', () => window.event.returnValue = false) }
        player = new Player(videoEl, {controls: true, autoplay: false, muted: false, live: false, debug: false, ...options}, {
            ...events,
		        onState: async (state: PlayerState, types: string[]) => {
                playerState = state;
                if (events.onState) {
                    await events.onState(state, types)
                }
		        }
        });
        if (src) { player.setSrc(src) }
        // dispatch('mounted', {element: videoEl, player,})
        const mountedEvent = new CustomEvent('mounted', {
            detail: {video: videoEl, player,},
            bubbles: true, cancelable: true,
            composed: true // makes the event jump shadow DOM boundary
        })
        videoEl.dispatchEvent(mountedEvent)
    })
    onDestroy(() => {
        player?.destroy()
    })
</script>

<!--Add this line to your web component-->
<svelte:options tag="hls-player"/>

<!--svelte-ignore a11y-media-has-caption-->
<video bind:this={videoEl}>
	<slot></slot>
</video>

<!--<div class="hls-player">-->
<!--	&lt;!&ndash; svelte-ignore a11y-media-has-caption &ndash;&gt;-->
<!--	<video bind:this={videoEl}>-->
<!--		<slot></slot>-->
<!--	</video>-->
<!--	<div>={src}=</div>-->
<!--	<div>{JSON.stringify(playerState)}</div>-->
<!--	&lt;!&ndash;<button on:click={preMinute}>seek to pre minute</button>&ndash;&gt;-->
<!--	&lt;!&ndash;<button on:click={nextMinute}>seek to next minute</button>&ndash;&gt;-->
<!--	<button on:click={() => player?.seekToTime(0)}>from start</button>-->
<!--	<button on:click={() => player?.play()}>play</button>-->
<!--	<button on:click={() => player?.pause()}>pause</button>-->
<!--	<span>loading: {loading}</span>-->
<!--</div>-->

<!--<style lang="scss">-->
<!--.hls-player {-->
<!--	video {-->
<!--		min-height: 200px;-->
<!--		//max-height: 210px;-->
<!--	}-->
<!--}-->
<!--</style>-->
