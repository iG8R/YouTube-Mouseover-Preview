// ==UserScript==
// @name         YouTube - Mouseover Preview (Ctrl Playback + Max Storyboard Quality + Rounded corners v3.37)
// @namespace    https://github.com/LenAnderson/
// @downloadURL  https://github.com/LenAnderson/YouTube-Mouseover-Preview/raw/master/youtube_mouseover_preview.user.js
// @version      3.37
// @author       LenAnderson
// @match        https://www.youtube.com/*
// @grant        GM_xmlhttpRequest
// @connect      youtube.com
// @connect      google.com
// ==/UserScript==

(function() {
    'use strict';

    // ---------------- SETTINGS ----------------
    const MOP_SETTINGS = {
        playbackFps: 3,               // Speed of playback (Frames per second)
        adjustCursorOnCtrlRelease: true, // If true, "moves" cursor to the stopped frame when Ctrl is released
        stationaryDelayMs: 200         // Time (ms) to wait before playing if mouse is stationary
    };

    // Global State for Ctrl Key
    let _isCtrlPressed = false;

// ---------------- IMPORTS  ----------------



// src\basics.js
const log = (...msgs)=>console.log.call(console.log, '[YT-MOP]', ...msgs);
const error = (...msgs)=>console.error.call(console.error, '[YT-MOP]', ...msgs);

const $ = (root,query)=>(query?root:document).querySelector(query?query:root);
const $$ = (root,query)=>Array.from((query?root:document).querySelectorAll(query?query:root));

const wait = async(millis)=>(new Promise(resolve=>setTimeout(resolve,millis)));


// src\debounce.js
const debounce = (func, delay)=>{
	let to;
	return (...args) => {
		if (to) clearTimeout(to);
		to = setTimeout(()=>func.apply(this, args), delay);
	};
}


// src\Coordinate.js
class Coordinate {
	/**@type{Number}*/ row;
	/**@type{Number}*/ col;

	constructor(/**@type{Number}*/row, /**@type{Number}*/col) {
		this.row = row;
		this.col = col;
	}
}


// src\StoryboardSheet.js


class StoryboardSheet {
	/**@type{Image}*/ img;
	/**@type{Number}*/ frameCount;
	/**@type{Number}*/ frameRowLength;
	/**@type{Number}*/ frameWidth;
	/**@type{Number}*/ frameHeight;




	constructor(/**@type{Image}*/img, /**@type{Number}*/frameRowLength, /**@type{Number}*/frameWidth, /**@type{Number}*/frameHeight) {
		this.img = img;
		this.frameRowLength = frameRowLength;
		this.frameWidth = frameWidth;
		this.frameHeight = frameHeight;

		this.frameCount = Math.floor((img.height / frameHeight) * (img.width / frameWidth));
	}




	getFrame(/**@type{Number}*/index) {
		return new Coordinate(Math.floor(index/this.frameRowLength), index%this.frameRowLength);
	}
}


// src\StoryboardFrame.js



class StoryboardFrame {
	/**@type{StoryboardSheet}*/ sheet;
	/**@type{Coordinate}*/ coordinate;


	get src() {
		return this.sheet.img.src;
	}
	
	get row() {
		return this.coordinate.row;
	}
	get col() {
		return this.coordinate.col;
	}




	constructor(/**@type{StoryboardSheet}*/sheet, /**@type{Coordinate}*/coordinate) {
		this.sheet = sheet;
		this.coordinate = coordinate;
	}
}


// src\xhr.js
const gm_fetch = async (url) => {
	return new Promise(resolve=>{
		GM_xmlhttpRequest({
			method: 'GET',
			url: url,
            // --- AUTH FIX: Send cookies implicitly and look like a browser for HD fetch ---
            //anonymous: false, 
            //headers: {
            //    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            //    'Referer': 'https://www.youtube.com/',
            //    'Cache-Control': 'max-age=0'
            //},
            // ----------------------------------------------------------------
			onload: (response)=>{
				response.text = async()=>response.responseText;
				resolve(response);
			},
		});
	});
};


// src\Storyboard.js




class Storyboard {
	/**@type{String}*/ url;
	/**@type{StoryboardSheet[]}*/ sheets;
	/**@type{Number}*/ frameCount = 0;
	/**@type{Number}*/ frameRowLength;
	/**@type{Number}*/ frameWidth;
	/**@type{Number}*/ frameHeight;
	/**@type{boolean}*/ exists = false;




	constructor(/**@type{String}*/url) {
		this.url = url;
	}




	async load() {
		try {
			const text = await (await (gm_fetch(this.url))).text();
			const specRe = /<script [^>]*>\s*var ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*var meta.*?<\/script>/s;
			const match = specRe.exec(text);
            if (!match) return;

            const rawSpecStr = JSON.parse(match[1])
				.storyboards
				.playerStoryboardSpecRenderer
				.spec;

            // --- NEW PARSING LOGIC (Based on StackOverflow Info) ---
            const parts = rawSpecStr.split('|');
            const urlBase = parts[0]; // The URL template
            
            // parts[1]...parts[N] are the levels.
            // We need to loop through them to find the best one.
            
            let bestData = null;
            let bestRes = 0;
            let bestIndex = 0; // This corresponds to $L

            // Iterate through the parts starting at index 1 (Level 0)
            for (let i = 1; i < parts.length; i++) {
                const levelStr = parts[i];
                // Format: Width#Height#Count#Cols#Rows#...#Signature
                const chunks = levelStr.split('#');
                
                // We need at least 5 chunks for dimensions, plus the signature at the end
                if (chunks.length < 5) continue;

                const w = parseInt(chunks[0], 10);
                const h = parseInt(chunks[1], 10);
                const count = parseInt(chunks[2], 10);
                const cols = parseInt(chunks[3], 10);
                const rows = parseInt(chunks[4], 10);
                const sig = chunks[chunks.length - 1]; // The signature is the LAST chunk

                if (isNaN(w) || isNaN(h)) continue;

                const res = w * h;
                
                // LOGGING: Show what we found
                //log(`Found Level ${i - 1}: ${w}x${h}`);

                // If this is the best resolution so far, save it
                if (res > bestRes) {
                    bestRes = res;
                    // The level index ($L) is i - 1 because parts[0] is the URL
                    bestIndex = i - 1; 
                    bestData = {
                        w: w, h: h, 
                        count: count, cols: cols, rows: rows,
                        sigh: sig
                    };
                }
            }

            if (!bestData) return;

            //log(`>>> SELECTED BEST: Level ${bestIndex} (${bestData.w}x${bestData.h})`);

			this.frameWidth = bestData.w;
			this.frameHeight = bestData.h;
			this.frameCount = bestData.count;
			this.frameRowLength = bestData.cols;
            const frameRowCount = bestData.rows;

            // Construct URL
            // 1. Replace $L with the best level index
            // 2. Append the specific signature for this level
			let http = urlBase.replace(/\\/g, '').replace('$L', bestIndex);
            
            // Ensure we handle query params correctly (? vs &)
            if (http.indexOf('?') === -1) {
                http += `?sigh=${bestData.sigh}`;
            } else {
                http += `&sigh=${bestData.sigh}`;
            }
            
            // log('URL:', http); // Debug URL

			const sheets = [];
			const promises = [];
            const numSheets = Math.ceil(this.frameCount / this.frameRowLength / frameRowCount);

			for (let i=0; i<numSheets; i++)(i=>{
				promises.push(new Promise((resolve,reject)=>{
					const img = new Image();
					img.addEventListener('error', ()=>{
                        // If HD fails, we mark undefined but continue
						sheets[i] = undefined;
						resolve();
					});
					img.addEventListener('load', ()=>{
						sheets[i] = new StoryboardSheet(img, this.frameRowLength, this.frameWidth, this.frameHeight);
						resolve();
					});
					img.src = http.replace('$N', `M${i}`);
				}));
			})(i);
			await Promise.all(promises);
			this.sheets = sheets.filter(it=>it);
			// this.frameCount = this.sheets.reduce((sum,cur)=>sum+cur.frameCount,0);
            // CRITICAL FIX: Only set exists=true if we actually have sheets
			this.exists = (this.sheets.length > 0);
		} catch (e) {
            console.error('[YT-MOP] Critical Error:', e);
			this.exists = false;
		}
	}




	getFrame(/**@type{Number}*/index) {
        if (!this.exists || !this.sheets || this.sheets.length === 0) return null;

		let nextFirstFrame = 0;
		let sheetIdx = -1;
		while (sheetIdx+1 < this.sheets.length && nextFirstFrame <= index) {
			nextFirstFrame += this.sheets[++sheetIdx].frameCount;
		}
        
        if (sheetIdx === -1 || !this.sheets[sheetIdx]) return null;
		const sheet = this.sheets[sheetIdx];

		return new StoryboardFrame(sheet, sheet.getFrame(index - (nextFirstFrame - sheet.frameCount)));
	}
}


// src\HoverTarget.js



class HoverTarget {
	/**@type{HTMLElement}*/ thumb;
	/**@type{HTMLElement}*/ container;
	/**@type{HTMLAnchorElement}*/ link;
	/**@type{String}*/ url;
	
	/**@type{HTMLElement}*/ #durationElement;
	/**@type{String}*/ durationText;
	/**@type{Number}*/ duration;
	/**@type{Number}*/ hoverTime;

	/**@type{boolean}*/ isHovered = false;

	/**@type{HTMLElement}*/ spinner;
	/**@type{HTMLElement}*/ spinnerText;
	
	/**@type{HTMLElement}*/ frameBlocker;
	/**@type{HTMLElement}*/ frameContainer;
	/**@type{HTMLElement}*/ frame;
    /**@type{HTMLElement}*/ progressBar; // New Progress Bar

	/**@type{Storyboard}*/ storyboard;

    // --- Playback State ---
    /**@type{Number}*/ playbackInterval = null;
    /**@type{Number}*/ currentFrameIdx = 0;
    /**@type{Number}*/ lastClientX = 0;
    /**@type{Number}*/ stationaryTimer = null;


	get durationElement() {
		if (!this.#durationElement) {
			const renderer = $(this.link, 'yt-thumbnail-overlay-badge-view-model, ytd-thumbnail-overlay-time-status-renderer');
			if (renderer) {
				this.#durationElement = $(renderer.shadowRoot || renderer, '#text');
			}
		}
		return this.#durationElement;
	}
	set durationElement(value) {
		this.#durationElement = value;
	}




	constructor(/**@type{HTMLElement}*/link) {
		this.thumb = link.closest('ytd-thumbnail, ytm-shorts-lockup-view-model') ?? $(link, 'yt-thumbnail-view-model');
		if (!this.thumb) {
			// debugger;
		}
		this.link = link;
		this.link.setAttribute('data-yt-mop', 1);
		this.link.addEventListener('pointerenter', (evt)=>this.enter(evt));
		this.thumb.addEventListener('pointermove', (evt)=>this.move(evt));
		this.thumb.addEventListener('pointerleave', (evt)=>this.leave(evt));
		this.link.addEventListener('click', (evt)=>{
			if (evt.shiftKey && this.hoverTime && this.duration) {
				evt.preventDefault();
				location.href = `${this.url}#t=${this.hoverTime}`;
			}
		});
	}




	async enter(/**@type{PointerEvent}*/evt) {
		// log('enter', this);
		this.isHovered = true;
        this.lastClientX = evt.clientX;

		if(this.link.href != this.url) {
			// log('load storyboard', this)
			this.storyboard = null;
			this.durationElement = null;
			this.url = this.link.href;
			
            // --- FIX: USE THUMBNAIL AS CONTAINER ---
            // Using the link (a) caused side panel issues because it includes text height.
            // Using 'this.thumb' targets the 16:9 container specifically.
            this.container = this.thumb;
            
            // Force relative positioning to contain the absolute preview
            if (this.container && getComputedStyle(this.container).position === 'static') {
                this.container.style.position = 'relative';
            }
            // ---------------------------------------

			this.hideOverlays();
			this.makeSpinner();
			await this.loadStoryboard();
            
			this.loadDuration();
			if (this.storyboard.exists) {
				const frameBlocker = document.createElement('div'); {
					this.frameBlocker = frameBlocker;
					frameBlocker.classList.add('yt-mop--frameBlocker');
					frameBlocker.style.position = 'absolute';
					frameBlocker.style.marginLeft = '0';
					frameBlocker.style.marginRight = '0';
					frameBlocker.style.top = '0';
					frameBlocker.style.left = '0';
                    // Force fill the 16:9 container
					frameBlocker.style.width = '100%';
					frameBlocker.style.height = '100%';
					frameBlocker.style.bottom = '0';
					frameBlocker.style.right = '0';
					frameBlocker.style.overflow = 'hidden';
					frameBlocker.style.backdropFilter = 'blur(10px)';
                    
                    // Allow mouse through to keep hover active
                    frameBlocker.style.pointerEvents = 'none'; 
                    frameBlocker.style.zIndex = '9999';

                    // --- v3.36: Radius Scanner ---
                    // Scan children (Image, Link) then Container to find the border radius
                    let borderRadius = '0px';
                    const candidates = [
                        $(this.thumb, 'img'),
                        $(this.thumb, '#thumbnail'),
                        $(this.thumb, 'a'),
                        this.thumb
                    ];
                    
                    for (const el of candidates) {
                        if (el) {
                            const style = window.getComputedStyle(el);
                            if (style.borderRadius && style.borderRadius !== '0px') {
                                borderRadius = style.borderRadius;
                                break;
                            }
                        }
                    }
                    frameBlocker.style.borderRadius = borderRadius;
                    // -----------------------------

                    // Progress Bar
                    const progressBar = document.createElement('div'); {
                        this.progressBar = progressBar;
                        progressBar.classList.add('yt-mop--progressBar');
                        progressBar.style.position = 'absolute';
                        progressBar.style.bottom = '0';
                        progressBar.style.left = '0';
                        progressBar.style.height = '4px';
                        progressBar.style.backgroundColor = '#f00';
                        progressBar.style.width = '0%';
                        progressBar.style.zIndex = '100';
                        progressBar.style.transition = 'width 0.1s linear';
                        frameBlocker.append(progressBar);
                    }

					const frameContainer = document.createElement('div'); {
						this.frameContainer = frameContainer;
						frameContainer.classList.add('yt-mop--frameContainer');
						frameContainer.style.position = 'absolute';
						frameContainer.style.marginLeft = '0';
						frameContainer.style.marginRight = '0';
						frameContainer.style.top = '0';
						frameContainer.style.left = '0';
						frameContainer.style.bottom = '0';
						frameContainer.style.right = '0';
						frameContainer.style.overflow = 'hidden';
						const frame = document.createElement('img'); {
							this.frame = frame;
							frame.classList.add('yt-mop--frame');
							frame.style.display = 'block';
							frame.style.position = 'absolute';
							frame.style.marginLeft = '0';
							frame.style.marginRight = '0';
							frame.style.maxHeight = 'none';
							frame.style.maxWidth = 'none';
							frame.style.borderRadius = 'none';
							frame.style.objectFit = 'unset';
							frame.style.height = 'auto';
							frameContainer.append(frame);
							if (this.isHovered) {
                                if (_isCtrlPressed) this.startPlayback();
								else this.showFrame(0);
							} else {
								this.hideFrame();
							}
						}
						frameBlocker.append(frameContainer);
					}
					this.container.append(frameBlocker);
				}
				this.hideSpinner();
			} else {
                // If failed, wait briefly then clean up
                if (this.spinnerText) this.spinnerText.textContent = 'No Storyboard';
				await wait(2000);
                if (this.isHovered) { // Only show overlay back if still hovering
				    this.hideSpinner();
				    this.showOverlays();
                } else {
                    this.hideSpinner();
                }
			}
		} else {
            if (this.storyboard && this.storyboard.exists) {
                if (_isCtrlPressed) this.startPlayback();
                else this.showFrame(this.lastClientX);
            }
        }
	}

	async move(/**@type{PointerEvent}*/evt) {
        this.lastClientX = evt.clientX;
        if (this.playbackInterval) return;

        if (this.stationaryTimer) clearTimeout(this.stationaryTimer);
        this.stationaryTimer = setTimeout(() => {
            if (this.isHovered && _isCtrlPressed && !this.playbackInterval) {
                this.startPlayback();
            }
        }, MOP_SETTINGS.stationaryDelayMs);

		this.showFrame(evt.clientX);
	}

	async leave(/**@type{PointerEvent}*/evt) {
		// log('leave', this);
		this.isHovered = false;
        this.stopPlayback();
        if (this.stationaryTimer) clearTimeout(this.stationaryTimer);
		this.hideFrame();
        this.hideSpinner(); // Ensure spinner is killed on exit
	}

    // --- Playback Functions ---
    startPlayback() {
        if (!this.storyboard || !this.storyboard.exists || this.playbackInterval) return;
        
        // Use sizingElement for rect calculation
        const rect = this.container.getBoundingClientRect();
        const x = (this.lastClientX - rect.left);
        const ratio = Math.max(0, Math.min(1, x / (rect.width || 1)));
        this.currentFrameIdx = Math.floor(ratio * this.storyboard.frameCount);

        this.playbackInterval = setInterval(() => {
            if (!this.isHovered) {
                this.stopPlayback();
                return;
            }
            this.currentFrameIdx = (this.currentFrameIdx + 1) % this.storyboard.frameCount;
            const frameRatio = this.currentFrameIdx / this.storyboard.frameCount;
            const fakeClientX = rect.left + (frameRatio * rect.width);
            this.showFrame(fakeClientX, true);
        }, 1000 / MOP_SETTINGS.playbackFps);
    }

    stopPlayback() {
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
            if (MOP_SETTINGS.adjustCursorOnCtrlRelease && this.storyboard && this.isHovered) {
                const rect = this.container.getBoundingClientRect();
                const frameRatio = this.currentFrameIdx / this.storyboard.frameCount;
                this.lastClientX = rect.left + (frameRatio * rect.width);
                this.showFrame(this.lastClientX);
            } else {
                this.showFrame(this.lastClientX);
            }
        }
    }


	async loadStoryboard() {
		this.storyboard = new Storyboard(this.url);
		await this.storyboard.load();
	}

	async loadDuration() {
		let tries = 200;
		while (tries-- > 0 && !this.durationElement) {
			await wait(200);
		}
		this.duration = 0;
		if (this.durationElement) {
			this.durationText = this.durationElement.textContent.trim();
			const durParts = this.durationText.split(':');
			durParts.forEach((part,idx)=>{
				this.duration += part * Math.pow(60, durParts.length - 1 - idx);
			});
		}
	}




	showFrame(/**@type{Number}*/clientX, isPlayback = false) {
		if (!this.storyboard || !this.storyboard.exists) return;
        if (this.playbackInterval && !isPlayback) return; 

        // Use the container (this.thumb) which is the 16:9 box
		const rect = this.container.getBoundingClientRect();
        
        let frameIdx;
        if (isPlayback) {
            frameIdx = this.currentFrameIdx;
        } else {
            const x = clientX - rect.left;
            const time = x / (rect.width || 0.01);
            this.showTime(time);
            frameIdx = Math.max(Math.round(time * this.storyboard.frameCount), 0);
        }

		const frame = this.storyboard.getFrame(frameIdx);
        if (!frame) return;

		this.frame.src = frame.src;
		this.frameBlocker.style.display = 'block';

        // Update Progress Bar
        if (this.progressBar) {
            const percentage = Math.min(100, Math.max(0, (frameIdx / this.storyboard.frameCount) * 100));
            this.progressBar.style.width = `${percentage}%`;
        }

		let iw;
		let ih;
		let fw;
		let fh;
        // --- "COVER" Logic (Fills container, crops excess) ---
        const rectRatio = rect.width / rect.height;
        const frameRatio = this.storyboard.frameWidth / this.storyboard.frameHeight;
        
        // Check if Video is Vertical (Portrait)
        const isVerticalVideo = (frameRatio < 1); 

        if (isVerticalVideo) {
            // VERTICAL Video: Fit Height, Align Center (Avoid top/bottom crop)
            fh = rect.height;
            fw = Math.round(rect.height * frameRatio);
            iw = Math.round(rect.height / this.storyboard.frameHeight * frame.sheet.img.width);
        } else {
            // LANDSCAPE Video: Standard Cover Logic (Fill box)
            if (rectRatio > frameRatio) {
                fw = rect.width;
                fh = Math.round(rect.width / frameRatio);
                iw = Math.round(rect.width / this.storyboard.frameWidth * frame.sheet.img.width);
            } else {
                fh = rect.height;
                fw = Math.round(rect.height * frameRatio);
                iw = Math.round(rect.height / this.storyboard.frameHeight * frame.sheet.img.width);
            }
        }
        // -----------------------------------------------------------

        // Apply dimensions
		this.frameContainer.style.left = `${(rect.width - fw)/2}px`;
		this.frameContainer.style.right = `${(rect.width - fw)/2}px`;
		this.frameContainer.style.top = `${(rect.height - fh)/2}px`;
		this.frameContainer.style.bottom = `${(rect.height - fh)/2}px`;

		this.frame.style.width = `${iw}px`;
		this.frame.style.top = `${-fh * frame.row}px`;
		this.frame.style.left = `${-fw * frame.col}px`;
	}
	hideFrame() {
		if (!this.frame) return;
		this.frameBlocker.style.display = 'none';
		this.hideTime();
	}

	showTime(/**@type{Number}*/time) {
		if (this.durationElement && this.duration) {
			time = Math.round(time * this.duration);
			this.hoverTime = time;
			const parts = [];
			let idx = 0;
			while (time > 0) {
				const ttime = Math.floor(time / 60);
				parts[idx] = Math.floor(time - ttime * 60);
				idx++;
				time = ttime;
			}
			const formatted = parts.reverse().map((it,idx)=>`${idx>0&&it<10?'0':''}${it}`).join(':');
			this.durationElement.textContent = formatted;
		}
	}
	hideTime() {
		if (this.durationElement && this.duration) {
			this.durationElement.textContent = this.durationText;
		}
	}




	makeSpinner() {
		const spinner = document.createElement('div'); {
			this.spinner = spinner;
			spinner.classList.add('yt-mop--spinner');
			Object.assign(spinner.style, {
                position: 'absolute',
                top: 0, 
                left: 0, 
                width: '100%', 
                height: '100%',
                display: 'flex',
                flexDirection: 'column', 
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.5)', 
                fontSize: '14px',
                textAlign: 'center', 
                lineHeight: '2', 
                color: 'rgb(0,0,0)',
                fontWeight: 'bold', 
                zIndex: 9999, 
            // Fix mouse events passing through
                pointerEvents: 'none'
            });
            
            // --- v3.36: Spinner Rounding ---
            // Try to find the border radius for the spinner too
            if (this.thumb) {
                let borderRadius = '0px';
                const candidates = [$(this.thumb, 'img'), $(this.thumb, '#thumbnail'), this.thumb];
                for (const el of candidates) {
                    if (el) {
                        const style = window.getComputedStyle(el);
                        if (style.borderRadius && style.borderRadius !== '0px') {
                            borderRadius = style.borderRadius;
                            break;
                        }
                    }
                }
                spinner.style.borderRadius = borderRadius;
            }

			const text = document.createElement('div'); {
				this.spinnerText = text;
				text.classList.add('ytd-mop--spinnerText');
				text.textContent = 'Loading Storyboard...';
				spinner.append(text);
			}
			this.container.append(spinner);
		}
	}
	showSpinner() {
		this.spinner.style.display = 'flex';
		this.spinnerText = 'Loading Storyboard...';
	}
	hideSpinner() {
        if (this.spinner) this.spinner.style.display = 'none';
	}


	showOverlays() {
		$$(this.link, '#mouseover-overlay').forEach(el=>el.style.display='');
	}
	hideOverlays() {
		$$(this.link, '#mouseover-overlay').forEach(el=>el.style.display='none');
	}
}


// src\MouseoverPreview.js




class MouseoverPreview {
	/**@type{HoverTarget[]}*/ targetList = [];




	constructor() {
		this.initHoverTargets(document.body);
		const mo = new MutationObserver(muts=>{
			debounce(()=>this.initHoverTargets(document.body), 300)();
		});
        mo.observe(document.body, {childList:true, subtree:true, attributes:true});

        // --- Global Key Listeners ---
        document.addEventListener('keydown', (evt) => {
            if (evt.key === 'Control') {
                _isCtrlPressed = true;
                this.targetList.forEach(t => {
                    // Start playback on active, non-playing targets
                    if (t.isHovered && !t.playbackInterval && t.storyboard && t.storyboard.exists) t.startPlayback();
                });
            }
        });
        document.addEventListener('keyup', (evt) => {
            if (evt.key === 'Control') {
                _isCtrlPressed = false;
                this.targetList.forEach(t => {
                    if (t.playbackInterval) t.stopPlayback();
                });
            }
        });
	}




	initHoverTargets(/**@type{HTMLElement}*/root) {
		$$(root, 'yt-lockup-view-model a[href^="/watch"]:has(yt-thumbnail-view-model):not([data-yt-mop]), ytd-thumbnail a[href^="/watch"]:not([data-yt-mop]), ytd-thumbnail a[href^="/shorts"]:not([data-yt-mop]), ytm-shorts-lockup-view-model a[href^="/shorts"]:not([data-yt-mop])').forEach(link=>{
			const target = new HoverTarget(link);
			this.targetList.push(target);
		});
	}
}
// ---------------- /IMPORTS ----------------




	
    // Updated Error Listener to ignore ResizeObserver loops
	window.addEventListener('error', (e) => {
        if (e.message && e.message.includes('ResizeObserver')) return;
        error(e);
    });
	window.addEventListener('unhandledrejection', error);




	const run = async()=>{
		// log('run');
		const app = new MouseoverPreview();
	};
	run();
})();