import debounce from 'lodash.debounce'

import SliderTrack from '@/SliderTrack'
import SliderArrow from '@/SliderArrow'
import SliderDots from '@/SliderDots'

import defaultProps from '@/defaultProps'
import initialState from '@/initialState'

import { getStyle } from '@/vNodeUtils'
import {
  PROP_KEYS,
  canGoNext,
  changeSlide,
  extractObject,
  filterUndefined,
  getHeight,
  getPreClones,
  getPostClones,
  getOnDemandLazySlides,
  getTrackCSS,
  getTrackLeft,
  initializedState,
  keyHandler,
  slideHandler,
  swipeEnd,
  swipeMove,
  swipeStart,
} from '@/innerSliderUtils'

export default {
  name: 'InnerSlider',
  components: {
    SliderTrack,
    SliderArrow,
    SliderDots,
  },
  inheritAttrs: false,
  props: [...Object.keys(defaultProps), 'unslick'],
  data() {
    return { ...initialState, currentSlide: this.initialSlide }
  },
  computed: {
    update() {
      // Read props that need to be listened for changes.
      Object.keys(this.$props).forEach(key => this[key])
      // Return a different value each time. `Date.now()` is not guaranteed to be unique.
      return (this.updateSwitch = !this.updateSwitch)
    },
    slideCount() {
      return this.$slots.default.length
    },
    spec() {
      return {
        ...this.$props,
        ...this.$data,
        slideCount: this.slideCount,
      }
    },
  },
  watch: {
    update() {
      this.propsUpdated(this.$props)
    },
  },
  created() {
    // non-reactive data
    this.callbackTimers = []
    this.clickable = true
    this.debouncedResize = null

    this.ssrInit()
    if (this.onInit) {
      this.onInit()
    }
    if (this.lazyLoad) {
      let slidesToLoad = getOnDemandLazySlides(this.spec)
      if (slidesToLoad.length > 0) {
        this.lazyLoadedList = this.lazyLoadedList.concat(slidesToLoad)
        if (this.onLazyLoad) {
          this.onLazyLoad(slidesToLoad)
        }
      }
    }
  },
  mounted() {
    let spec = {
      listRef: this.$refs.list,
      trackRef: this.$refs.track,
      children: this.$slots.default,
      ...this.$props,
    }
    this.updateState(spec, true)
    this.adaptHeight()
    if (this.autoPlay) {
      this.autoPlay('update')
    }
    if (this.lazyLoad === 'progressive') {
      this.lazyLoadTimer = setInterval(this.progressiveLazyLoad, 1000)
    }
    this.ro = new ResizeObserver(() => {
      if (this.animating) {
        this.onWindowResized(false) // don't set trackStyle hence don't break animation
        this.callbackTimers.push(
          setTimeout(() => this.onWindowResized(), this.speed),
        )
      } else {
        this.onWindowResized()
      }
    })
    this.ro.observe(this.$refs.list)
    Array.prototype.forEach.call(
      document.querySelectorAll('.slick-slide'),
      slide => {
        slide.onfocus = this.pauseOnFocus ? this.onSlideFocus : null
        slide.onblur = this.pauseOnFocus ? this.onSlideBlur : null
      },
    )
    // To support server-side rendering
    if (!window) {
      return
    }
    if (window.addEventListener) {
      window.addEventListener('resize', this.onWindowResized)
    } else {
      window.attachEvent('onresize', this.onWindowResized)
    }
  },
  updated() {
    this.checkImagesLoad()
    this.onReInit && this.onReInit()
    if (this.lazyLoad) {
      let slidesToLoad = getOnDemandLazySlides({
        ...this.$props,
        ...this.$data,
      })
      if (slidesToLoad.length > 0) {
        this.lazyLoadedList = this.lazyLoadedList.concat(slidesToLoad)
        if (this.onLazyLoad) {
          this.onLazyLoad(slidesToLoad)
        }
      }
    }
    this.adaptHeight()
  },
  destroyed() {
    if (this.animationEndCallback) {
      clearTimeout(this.animationEndCallback)
    }
    if (this.lazyLoadTimer) {
      clearInterval(this.lazyLoadTimer)
    }
    if (this.callbackTimers.length) {
      this.callbackTimers.forEach(timer => clearTimeout(timer))
      this.callbackTimers = []
    }
    if (window.addEventListener) {
      window.removeEventListener('resize', this.onWindowResized)
    } else {
      window.detachEvent('onresize', this.onWindowResized)
    }
    if (this.autoplayTimer) {
      clearInterval(this.autoplayTimer)
    }
  },
  methods: {
    propsUpdated(nextProps) {
      let spec = {
        listRef: this.$refs.list,
        trackRef: this.$refs.track,
        children: this.$slots.default,
        ...nextProps,
        ...this.$data,
      }
      let setTrackStyle = false
      for (let key of Object.keys(this.$props)) {
        if (!nextProps.hasOwnProperty(key)) {
          setTrackStyle = true
          break
        }
        if (
          typeof nextProps[key] === 'object' ||
          typeof nextProps[key] === 'function'
        ) {
          continue
        }
        if (nextProps[key] !== this.$props[key]) {
          setTrackStyle = true
          break
        }
      }
      this.updateState(spec, setTrackStyle)
      if (this.currentSlide >= this.slideCount) {
        this.changeSlide({
          message: 'index',
          index: this.slideCount - nextProps.slidesToShow,
          currentSlide: this.currentSlide,
        })
      }
      if (nextProps.autoplay) {
        this.autoPlay('update')
      } else {
        this.pause('paused')
      }
    },
    updateState(spec, setTrackStyle) {
      let updatedState = initializedState(spec)
      spec = { ...spec, ...updatedState, slideIndex: updatedState.currentSlide }
      let targetLeft = getTrackLeft(spec)
      spec = { ...spec, left: targetLeft }
      let trackStyle = getTrackCSS(spec)
      if (setTrackStyle || this.slideCount !== spec.children.length) {
        updatedState['trackStyle'] = trackStyle
      }
      Object.assign(this.$data, updatedState)
    },
    adaptHeight() {
      if (this.adaptiveHeight && this.$refs.list) {
        const elem = this.$refs.list.querySelector(
          `[data-index="${this.currentSlide}"]`,
        )
        this.$refs.list.style.height = getHeight(elem) + 'px'
      }
    },
    ssrInit() {
      const preClones = getPreClones(this.spec)
      const postClones = getPostClones(this.spec)
      if (this.variableWidth) {
        let trackWidth = [],
          trackLeft = []
        let childrenWidths = []
        this.$slots.default.forEach(child => {
          const { width } = getStyle(child)
          childrenWidths.push(width)
          trackWidth.push(width)
        })
        for (let i = 0; i < preClones; i++) {
          trackLeft.push(childrenWidths[childrenWidths.length - 1 - i])
          trackWidth.push(childrenWidths[childrenWidths.length - 1 - i])
        }
        for (let i = 0; i < postClones; i++) {
          trackWidth.push(childrenWidths[i])
        }
        for (let i = 0; i < this.currentSlide; i++) {
          trackLeft.push(childrenWidths[i])
        }
        // filter undefined
        trackWidth = trackWidth.filter(o => o)
        trackLeft = trackLeft.filter(o => o)
        let trackStyle = {
          width: `calc(${trackWidth.join(' + ')})`,
          left: `calc(${trackLeft.map(o => `-${o}`).join(' + ')})`,
        }
        if (this.centerMode) {
          let currentWidth = childrenWidths[this.currentSlide]
          trackStyle.left = `calc(${trackLeft
            .map(o => `-${o}`)
            .join(' + ')} + (100% - ${currentWidth}) / 2 )`
        }
        this.trackStyle = trackStyle
      } else {
        let slideCount = preClones + postClones + this.slideCount
        let trackWidth = (100 / this.slidesToShow) * slideCount
        let slideWidth = 100 / slideCount
        let trackLeft =
          (-slideWidth * (preClones + this.currentSlide) * trackWidth) / 100
        if (this.centerMode) {
          trackLeft += (100 - (slideWidth * trackWidth) / 100) / 2
        }
        this.slideWidth = slideWidth + '%'
        this.trackStyle = {
          width: trackWidth + '%',
          left: trackLeft + '%',
        }
      }
    },
    slideHandler(index, dontAnimate = false) {
      const { asNavFor, beforeChange, onLazyLoad, speed, afterChange } = this
      // capture currentslide before state is updated
      const currentSlide = this.currentSlide
      let { state, nextState } = slideHandler({
        index,
        ...this.$props,
        ...this.$data,
        trackRef: this.$refs.track,
        useCSS: this.useCSS && !dontAnimate,
      })
      if (!state) return
      beforeChange && beforeChange(currentSlide, state.currentSlide)
      let slidesToLoad = state.lazyLoadedList.filter(
        value => this.lazyLoadedList.indexOf(value) < 0,
      )
      onLazyLoad && slidesToLoad.length > 0 && onLazyLoad(slidesToLoad)
      Object.assign(this.$data, state)
      asNavFor && asNavFor.innerSlider.slideHandler(index)
      if (!nextState) return
      this.animationEndCallback = setTimeout(() => {
        const { animating, ...firstBatch } = nextState
        Object.assign(this.$data, firstBatch)
        this.callbackTimers.push(
          setTimeout(() => {
            this.animating = animating
          }, 10),
        )
        afterChange && afterChange(state.currentSlide)
        // delete this.animationEndCallback
        this.animationEndCallback = undefined
      }, speed)
    },
    onWindowResized(setTrackStyle) {
      if (this.debouncedResize) this.debouncedResize.cancel()
      this.debouncedResize = debounce(
        () => this.resizeWindow(setTrackStyle),
        50,
      )
      this.debouncedResize()
    },
    resizeWindow(setTrackStyle = true) {
      if (!this.$refs.track.$el) return
      let spec = {
        listRef: this.$refs.list,
        trackRef: this.$refs.track,
        children: this.$slots.default,
        ...this.$props,
        ...this.$data,
      }
      this.updateState(spec, setTrackStyle)
      if (this.autoplay) {
        this.autoPlay('update')
      } else {
        this.pause('paused')
      }
      // animating state should be cleared while resizing, otherwise autoplay stops working
      this.animating = false
      clearTimeout(this.animationEndCallback)
      // delete this.animationEndCallback
      this.animationEndCallback = undefined
    },
    checkImagesLoad() {
      let images = document.querySelectorAll('.slick-slide img')
      let imagesCount = images.length,
        loadedCount = 0
      Array.prototype.forEach.call(images, image => {
        const handler = () =>
          ++loadedCount && loadedCount >= imagesCount && this.onWindowResized()
        if (!image.onclick) {
          image.onclick = () => image.parentNode.focus()
        } else {
          const prevClickHandler = image.onclick
          image.onclick = () => {
            prevClickHandler()
            image.parentNode.focus()
          }
        }
        if (!image.onload) {
          if (this.lazyLoad) {
            image.onload = () => {
              this.adaptHeight()
              this.callbackTimers.push(
                setTimeout(this.onWindowResized, this.props.speed),
              )
            }
          } else {
            image.onload = handler
            image.onerror = () => {
              handler()
              this.onLazyLoadError && this.onLazyLoadError()
            }
          }
        }
      })
    },
    progressiveLazyLoad() {
      let slidesToLoad = []
      const spec = { ...this.$props, ...this.$data }
      for (
        let index = this.currentSlide;
        index < this.slideCount + getPostClones(spec);
        index++
      ) {
        if (this.lazyLoadedList.indexOf(index) < 0) {
          slidesToLoad.push(index)
          break
        }
      }
      for (
        let index = this.currentSlide - 1;
        index >= -getPreClones(spec);
        index--
      ) {
        if (this.lazyLoadedList.indexOf(index) < 0) {
          slidesToLoad.push(index)
          break
        }
      }
      if (slidesToLoad.length > 0) {
        this.lazyLoadedList = this.lazyLoadedList.concat(slidesToLoad)
        if (this.onLazyLoad) {
          this.onLazyLoad(slidesToLoad)
        }
      } else {
        if (this.lazyLoadTimer) {
          clearInterval(this.lazyLoadTimer)
          // delete this.lazyLoadTimer;
          this.lazyLoadTimer = undefined
        }
      }
    },
    clickHandler(e) {
      if (this.clickable === false) {
        e.stopPropagation()
        e.preventDefault()
      }
      this.clickable = true
    },
    keyHandler(e) {
      let dir = keyHandler(e, this.accessibility, this.rtl)
      dir !== '' && this.changeSlide({ message: dir })
    },
    changeSlide(options, dontAnimate = false) {
      const spec = { ...this.$props, ...this.$data }
      let targetSlide = changeSlide(spec, options)
      if (targetSlide !== 0 && !targetSlide) return
      if (dontAnimate === true) {
        this.slideHandler(targetSlide, dontAnimate)
      } else {
        this.slideHandler(targetSlide)
      }
    },
    swipeStart(e) {
      if (this.verticalSwiping) {
        this.disableBodyScroll()
      }
      let state = swipeStart(e, this.swipe, this.draggable)
      if (state !== '') {
        Object.assign(this.$data, state)
      }
    },
    swipeMove(e) {
      let state = swipeMove(e, {
        ...this.$props,
        ...this.$data,
        trackRef: this.$refs.track,
        listRef: this.$refs.list,
        slideIndex: this.currentSlide,
      })
      if (!state) return
      if (state['swiping']) {
        this.clickable = false
      }
      Object.assign(this.$data, state)
    },
    swipeEnd(e) {
      let state = swipeEnd(e, {
        ...this.$props,
        ...this.$data,
        trackRef: this.$refs.track,
        listRef: this.$refs.list,
        slideIndex: this.currentSlide,
      })
      if (!state) return
      let triggerSlideHandler = state['triggerSlideHandler']
      // delete state["triggerSlideHandler"];
      this.triggerSlideHandler = undefined
      Object.assign(this.$data, state)
      if (triggerSlideHandler === undefined) return
      this.slideHandler(triggerSlideHandler)
      if (this.verticalSwiping) {
        this.enableBodyScroll()
      }
    },
    slickPrev() {
      // this and fellow methods are wrapped in setTimeout
      // to make sure initialize setState has happened before
      // any of such methods are called
      this.callbackTimers.push(
        setTimeout(() => this.changeSlide({ message: 'previous' }), 0),
      )
    },
    slickNext() {
      this.callbackTimers.push(
        setTimeout(() => this.changeSlide({ message: 'next' }), 0),
      )
    },
    slickGoTo(slide, dontAnimate = false) {
      slide = Number(slide)
      if (isNaN(slide)) return ''
      this.callbackTimers.push(
        setTimeout(
          () =>
            this.changeSlide(
              {
                message: 'index',
                index: slide,
                currentSlide: this.currentSlide,
              },
              dontAnimate,
            ),
          0,
        ),
      )
    },
    play() {
      var nextIndex
      if (this.rtl) {
        nextIndex = this.currentSlide - this.slidesToScroll
      } else {
        if (canGoNext({ ...this.$props, ...this.$data })) {
          nextIndex = this.currentSlide + this.slidesToScroll
        } else {
          return false
        }
      }

      this.slideHandler(nextIndex)
    },
    autoPlay(playType) {
      if (this.autoplayTimer) {
        clearInterval(this.autoplayTimer)
      }
      const autoplaying = this.autoplaying
      if (playType === 'update') {
        if (
          autoplaying === 'hovered' ||
          autoplaying === 'focused' ||
          autoplaying === 'paused'
        ) {
          return
        }
      } else if (playType === 'leave') {
        if (autoplaying === 'paused' || autoplaying === 'focused') {
          return
        }
      } else if (playType === 'blur') {
        if (autoplaying === 'paused' || autoplaying === 'hovered') {
          return
        }
      }
      this.autoplayTimer = setInterval(this.play, this.autoplaySpeed + 50)
      this.autoplaying = 'playing'
    },
    pause(pauseType) {
      if (this.autoplayTimer) {
        clearInterval(this.autoplayTimer)
        this.autoplayTimer = null
      }
      const autoplaying = this.autoplaying
      if (pauseType === 'paused') {
        this.autoplaying = 'paused'
      } else if (pauseType === 'focused') {
        if (autoplaying === 'hovered' || autoplaying === 'playing') {
          this.autoplaying = 'focused'
        }
      } else {
        // pauseType  is 'hovered'
        if (autoplaying === 'playing') {
          this.autoplaying = 'hovered'
        }
      }
    },
    onDotsOver() {
      this.autoplay && this.pause('hovered')
    },
    onDotsLeave() {
      this.autoplay && this.autoplaying === 'hovered' && this.autoPlay('leave')
    },
    onTrackOver() {
      this.autoplay && this.pause('hovered')
    },
    onTrackLeave() {
      this.autoplay && this.autoplaying === 'hovered' && this.autoPlay('leave')
    },
    onSlideFocus() {
      this.autoplay && this.pause('focused')
    },
    onSlideBlur() {
      this.autoplay && this.autoplaying === 'focused' && this.autoPlay('blur')
    },
    selectHandler(options) {
      this.changeSlide(options)
    },
  },
  render() {
    const className = {
      'slick-slider': true,
      'slick-initialized': true,
      'slick-vertical': this.vertical,
    }
    let trackProps = extractObject(this.spec, PROP_KEYS.TRACK)
    trackProps = filterUndefined({
      ...trackProps,
      focusOnSelect: this.focusOnSelect ? this.selectHandler : undefined,
    })
    const { pauseOnHover } = this
    const trackNativeOn = filterUndefined({
      mouseenter: pauseOnHover ? this.onTrackOver : undefined,
      mouseover: pauseOnHover ? this.onTrackOver : undefined,
      mouseleave: pauseOnHover ? this.onTrackLeave : undefined,
    })

    let dots
    if (this.dots === true && this.slideCount >= this.slidesToShow) {
      let dotProps = extractObject(this.spec, PROP_KEYS.DOT)
      dotProps.clickHandler = this.changeSlide
      const { pauseOnDotsHover } = this
      const dotNativeOn = filterUndefined({
        mouseenter: pauseOnDotsHover ? this.onDotsLeave : undefined,
        mouseover: pauseOnDotsHover ? this.onDotsOver : undefined,
        mouseleave: pauseOnDotsHover ? this.onDotsLeave : undefined,
      })
      dots = (
        <SliderDots {...{ props: dotProps }} {...{ nativeOn: dotNativeOn }} />
      )
    }

    let prevArrow, nextArrow
    let arrowProps = extractObject(this.spec, PROP_KEYS.ARROW)
    arrowProps.clickHandler = this.changeSlide

    if (this.arrows) {
      prevArrow = (
        <SliderArrow {...{ props: { ...arrowProps, type: 'previous' } }} />
      )
      nextArrow = (
        <SliderArrow {...{ props: { ...arrowProps, type: 'next' } }} />
      )
    }

    var verticalHeightStyle = null
    if (this.vertical) {
      verticalHeightStyle = {
        height: this.listHeight,
      }
    }

    var centerPaddingStyle = null
    if (this.vertical === false) {
      if (this.centerMode === true) {
        centerPaddingStyle = {
          padding: '0px ' + this.centerPadding,
        }
      }
    } else {
      if (this.centerMode === true) {
        centerPaddingStyle = {
          padding: this.centerPadding + ' 0px',
        }
      }
    }
    let listStyle = {}
    if (!this.unslick) {
      listStyle = { ...verticalHeightStyle, ...centerPaddingStyle }
    }

    const { accessibility, dragging, touchMove } = this
    const listOn = filterUndefined({
      click: this.clickHandler,
      mousedown: touchMove ? this.swipeStart : undefined,
      mousemove: dragging && touchMove ? this.swipeMove : undefined,
      mouseup: touchMove ? this.swipeEnd : undefined,
      mouseleave: dragging && touchMove ? this.swipeEnd : undefined,
      touchstart: touchMove ? this.swipeStart : undefined,
      touchmove: dragging && touchMove ? this.swipeMove : undefined,
      touchend: touchMove ? this.swipeEnd : undefined,
      touchcancel: dragging && touchMove ? this.swipeEnd : undefined,
      keydown: accessibility ? this.keyHandler : undefined,
    })

    return (
      <div class={className} dir={!this.unslick ? 'ltr' : false}>
        {!this.unslick ? prevArrow : ''}
        <div
          ref="list"
          class={'slick-list'}
          {...{ on: listOn }}
          style={listStyle}>
          <SliderTrack
            ref="track"
            {...{ props: trackProps }}
            {...{ nativeOn: trackNativeOn }}>
            {this.$slots.default}
          </SliderTrack>
        </div>
        {!this.unslick ? nextArrow : ''}
        {!this.unslick ? dots : ''}
      </div>
    )
  },
}