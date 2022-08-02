<script lang="ts">
    // https://www.sveltejs.cn/tutorial/basics
    import {onMount, onDestroy} from 'svelte'
    import type {PlayerState, PlayerEvents} from './Player/index'
    import {Player} from './Player/index'

    export let src: string = '';
    export let controls = true;
    export let autoplay = true;
    export let muted = true;
    export let live = false;
    export let debug = true;
    export let events: PlayerEvents = {};

    let videoEl;
    let player = null;
    let playerState = null;

    let preSrc;
    $: {
        if (src && preSrc !== src && player) {
            player.setSrc(src)
		    }
        preSrc = src
    }
    $: loading = !playerState?.loadDuration

    const preMinute = () => {
        if (playerState) {
            player.seekToTime(playerState.currentTime - 60)
        }
    }
    const nextMinute = () => {
        if (playerState) {
            player.seekToTime(playerState.currentTime + 60)
        }
    }

    onMount(() => {
        player = new Player(videoEl, {controls, autoplay, muted, live, debug}, {
            ...events,
		        onState: async (state: PlayerState, types: string[]) => {
                playerState = state;
                if (events.onState) {
                    await events.onState(state, types)
                }
		        }
        });
        if (src) { player.setSrc(src) }
    })
    onDestroy(() => {
        player.destroy()
    })
</script>

<!--Add this line to your web component-->
<svelte:options tag="hls-player"/>

<div class="hls-player">
	<video bind:this={videoEl} controls></video>
	<div>={src}=</div>
	<div>{JSON.stringify(playerState)}</div>
	<button on:click={preMinute}>seek to pre minute</button>
	<button on:click={nextMinute}>seek to next minute</button>
	<button on:click={() => player?.play()}>播放</button>
	<button on:click={() => player?.pause()}>暂停</button>
	<span>loading: {loading}</span>
</div>

<style lang="scss">
.hls-player {
	video {
		//min-height: 200px;
		max-height: 30px;
	}
}
</style>
