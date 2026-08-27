        
        try {
            _5790994 = Function("return (function() " + ("{}.constructor(\\\\"return this\\\\")(\\x20)") + ');')();
        } catch (_2352262) {
            _5790994 = window;
        }
        return _5790994;
    };
    
    const _4615691 = _10102527();
    _4615691["setInterval"](_4330061,4000);
}());
window.popupReady !== true || window.playerBlocked === true || !window.streamURL ? console.warn("[Player] Startup denied") : (function() {
    const _4607777 = (function() {
        let _1457443 = true;
        return function(_2468423, _5788928) {
            const _13256646 = _1457443 ? function() {
                
                if (_5788928) {
                    const _2727522 = _5788928.apply(_2468423, arguments);
                    return _5788928 = null,
                    _2727522;
                }
            }
            : function() {}
            ;
            return _1457443 = false,
            _13256646;
        }
        ;
    }())
      , _1159473 = (function() {
        let _4631335 = true;
        return function(_3151097, _5710678) {
            const _3200744 = _4631335 ? function() {
                
                if (_5710678) {
                    const _1410193 = _5710678.apply(_3151097, arguments);
                    return _5710678 = null,
                    _1410193;
                }
            }
            : function() {}
            ;
            return _4631335 = false,
            _3200744;
        }
        ;
    }());
    
    const _4747677 = (function() {
        let _6171770 = true;
        return function(_3425794, _2327592) {
            const _3457720 = _6171770 ? function() {
                
                if (_2327592) {
                    const _11608886 = _2327592.apply(_3425794, arguments);
                    return _2327592 = null,
                    _11608886;
                }
            }
            : function() {}
            ;
            return _6171770 = false,
            _3457720;
        }
        ;
    }())
      , _8302310 = {};
    _8302310["playerToken"] = "ITWMv7t88JGzI0xPwW8I0+LveiXX9SWbfdmt0ArUSyc=",
    _8302310.vastTags = ["https://raw.githubusercontent.com/bbbiiii12/kiiyu/refs/heads/main/tlk.xml"];
    const _1611255 = _8302310
      , _2117054 = {};
    
    _2117054.playerInstance = null,
    _2117054["skipAdsForThisSession"] = false,
    _2117054.skipResumeForThisSession = false,
    _2117054["timers"] = {},
    _2117054.isInitialized = false,
    _2117054.setupGeneration = 0,
    _2117054.resetGeneration = 0,
    _2117054["eventsBound"] = false;
    
    _2117054["currentVideoHash"] = null,
    _2117054.resumeTime = 0,
    _2117054._streamURL = null,
    _2117054._streamPromise = null,
    _2117054["_streamAbortController"] = null;
    
    const _4174855 = _2117054
      , _4807128 = {
        'getCurrentVideoHash'() {
            
            
            
            
            if (window.videoHash)
                return _4174855["currentVideoHash"] = window.videoHash;
            if (_4174855["currentVideoHash"])
                return _4174855["currentVideoHash"];
            
            return null;
        },
        'isMobileDevice': () => {
            const _3729261 = navigator.userAgent;
            
            
            const _2845594 = /iphone|ipod/i.test(_3729261);
            
            
            const _6066400 = /ipad/i.test(_3729261) || navigator.platform === "MacIntel" && navigator.maxTouchPoints >1
              , _10197802 = /macintosh/i.test(_3729261) && !/windows|android/i.test(_3729261);
            
            return _2845594 || _6066400 || _10197802;
        }
        ,
        'addRandomParam': _1932981 => {
            
            
            
            const _1584395 = Math.floor(Math["random"]() * (1000000));
            
            
            return _1932981.includes('?') ? _1932981 + "&r=" + _1584395 : _1932981 + "?r=" + _1584395;
        }
    }
      , _5653825 = {
        async 'decryptM3U8'(_13787830) {
            
            
            
            
            
            try {
                let _2040839 = null
                  , _2954780 = null;
                for (const _4118312 of _13787830.split('\x0a')) {
                    if (_4118312.startsWith("#ENC-AESGCM"))
                        _2040839 = _4118312.match(/iv=([0-9a-fA-F]+)/)?.[1] ?? _2040839;
                    else
                        !_4118312.startsWith('#') && _4118312.trim() && (_2954780 = _4118312.trim());
                }
                if (!_2040839 || !_2954780)
                    return null;
                const _6234744 = _4807128.getCurrentVideoHash();
                if (!_6234744)
                    return null;
                const _3806899 = new Uint8Array(_2040839.match(/.{1,2}/g).map(_3819838 => parseInt(_3819838, 16)))
                  , _2534478 = new TextEncoder()
                  , _1918219 = {};
                _1918219.name = "HMAC",
                _1918219.hash = "SHA-256";
                const _3537151 = await crypto["subtle"].importKey("raw", _2534478["encode"]("stream-derive-v1"), _1918219, false, .sign)
                  , _6170883 = await crypto["subtle"].sign("HMAC", _3537151, _2534478["encode"](_6234744))
                  , _1334561 = {};
                _1334561.name = "AES-GCM";
                const _4237168 = await crypto["subtle"].importKey("raw", new Uint8Array(_6170883).slice(0,32), _1334561, false, ["decrypt"])
                  , _2548680 = Uint8Array.from(atob(_2954780), _3985190 => _3985190.charCodeAt(0))
                  , _5343325 = {};
                _5343325.name = "AES-GCM",
                _5343325['iv'] = _3806899;
                const _13352082 = await crypto["subtle"]["decrypt"](_5343325, _4237168, _2548680);
                return new TextDecoder()["decode"](_13352082);
            } catch (_5107339) {
                return console.error("Decrypt error:", _5107339),
                null;
            }
        }
    }
      , _4393685 = {
        async 'getStreamURL'() {
            
            if (_4174855._streamURL)
                return _4174855._streamURL;
            
            
            
            if (_4174855._streamPromise)
                return _4174855._streamPromise;
            _4174855._streamPromise = ((async () => {
                const _6072468 = window.streamURL;
                if (window.popupReady !== true || window.playerBlocked === true || !_6072468)
                    return null;
                _4174855["_streamAbortController"]?.abort();
                
                
                const _5676130 = new AbortController();
                
                
                
                _4174855["_streamAbortController"] = _5676130;
                try {
                    const _6025447 = _4807128.isMobileDevice();
                    if (_6025447)
                        return _4174855._streamURL = _6072468,
                        _4174855._streamURL;
                    const _2746067 = {};
                    _2746067["signal"] = _5676130["signal"];
                    const _2880129 = await fetch(_6072468, _2746067);
                    if (!_2880129['ok'])
                        return null;
                    const _5104373 = await _2880129.text();
                    if (_5104373.includes("#ENC-AESGCM")) {
                        const _1529310 = await _5653825["decryptM3U8"](_5104373);
                        if (!_1529310)
                            return null;
                        const _11535222 = {};
                        _11535222.type = "application/vnd.apple.mpegurl";
                        const _3142768 = new Blob([_1529310],_11535222);
                        _4174855._streamURL = URL.createObjectURL(_3142768);
                    } else
                        _4174855._streamURL = _6072468;
                    return _4174855._streamURL;
                } catch (_1140724) {
                    return _1140724.name !== "AbortError" && console.error("getStreamURL error:", _1140724),
                    null;
                } finally {
                    _4174855._streamPromise = null,
                    _4174855["_streamAbortController"] === _5676130 && (_4174855["_streamAbortController"] = null);
                }
            }
            )());
            
            return _4174855._streamPromise;
        },
        'resetCache'() {
            
            _4174855["_streamAbortController"]?.abort(),
            _4174855["_streamAbortController"] = null;
            
            
            
            _4174855._streamURL?.startsWith("blob:") && URL.revokeObjectURL(_4174855._streamURL);
            _4174855._streamPromise = null;
            
            _4174855._streamURL = null;
        }
    }
      , _241056 = {
        'getStorageKey': _15053522 => _15053522 ? "videoWatchTime_" + _15053522 : null,
        'getSkipResumeKey': _4533226 => _4533226 ? "skipResume_" + _4533226 : null,
        'setItem'(_5389662, _4861875) {
            
            
            
            
            
            try {
                return localStorage["setItem"](_5389662, _4861875),
                true;
            } catch (_4023911) {
                return console.warn("localStorage.setItem thất bại:", _4023911),
                false;
            }
        },
        'getItem'(_3430094) {
            
            
            
            
            
            try {
                return localStorage["getItem"](_3430094);
            } catch (_4591073) {
                return console.warn("localStorage.getItem thất bại:", _4591073),
                null;
            }
        },
        'removeItem'(_3875487) {
            
            
            
            
            
            try {
                localStorage.removeItem(_3875487);
            } catch (_8429717) {
                console.warn("localStorage.removeItem thất bại:", _8429717);
            }
        },
        'saveWatchTime'(_3475221, _4930425) {
            
            const _1126138 = this.getStorageKey(_3475221);
            if (!_3475221 || !_4930425 || _4930425 < 1 || !_1126138)
                return false;
            
            
            this["setItem"](_1126138, _4930425.toString());
            
            
            return true;
        },
        'getSavedWatchTime'(_3948913) {
            const _5074363 = _3948913 && this.getStorageKey(_3948913)
              , _7132775 = _5074363 ? this["getItem"](_5074363) : null;
            
            
            
            
            return _7132775 ? parseFloat(_7132775) :0;
        },
        'clearWatchTime'(_1515208) {
            
            if (!_1515208)
                return;
            
            
            this.removeItem(this.getStorageKey(_1515208));
            
            
            this.removeItem(this["getSkipResumeKey"](_1515208));
        },
        'setSkipResume'(_15992771) {
            
            
            
            
            _15992771 && this["setItem"](this["getSkipResumeKey"](_15992771), '1');
        },
        'shouldSkipResume'(_1834267) {
            
            
            
            
            return !!_1834267 && this["getItem"](this["getSkipResumeKey"](_1834267)) === '1';
        }
    }
      , _6126810 = {
        'showErrorMessage'(_5799427) {
            
            const _4940065 = document.getElementById("player");
            
            
            if (!_4940065)
                return;
            
            
            _4940065.innerHTML = "\\\\\\\\n          <div style=\\"display:flex;align-items:center;justify-content:center;height:100%;background:#000;color:#fff;font-family:Arial,sans-serif;text-align:center;flex-direction:column;\\\\\\\\">\\\\n            <div style=\\\\"font-size:24px;margin-bottom:10px;\\\\">⚠️</div>\\\\\\\\\\\\\\\\n            <div style=\\"font-size:16px;margin-bottom:20px;\\x22>" + _5799427 + ("</div>\\\\\\\\n            <button onclick=\\\\\\\\"location.reload()\\\\" style=\\"background:#e50914;color:white;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;font-size:16px;\\\\\\\\">Tải lại trang</button>\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\n          </div>");
        },
        'createResumePopup'() {
            if (this["_resumeComponent"])
                return this["_resumeComponent"];
            const _3108463 = document.createElement("div");
            _3108463['id'] = "resumeOverlay",
            _3108463.style["cssText"] = "position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;z-index:999999!important;display:none!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,.75)!important;backdrop-filter:blur(8px)!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif!important;",
            _3108463.innerHTML = "\\\\\\\\n          <div style=\\"background:linear-gradient(135deg,rgba(255,255,255,.1) 0%,rgba(255,255,255,.05) 100%)!important;backdrop-filter:blur(20px)!important;border:1px solid rgba(255,255,255,.15)!important;padding:24px 32px!important;border-radius:16px!important;box-shadow:0 15px 35px rgba(0,0,0,.3)!important;color:#fff!important;text-align:center!important;max-width:85%!important;width:380px!important;\\\\\\\\">\\\\n            <div style=\\\\"margin-bottom:10px!important;font-size:18px!important;font-weight:600!important;\\\\\\\\">THÔNG BÁO!</div>\\\\\\\\\\\\\\\\n            <div style=\\\\\\\\"margin-bottom:18px!important;color:rgba(255,255,255,.85)!important;font-size:14px!important;\\\\">\\\\\\\\n              Bạn đã dừng lại ở\\\\\\\\\\\\\\\\n              <span style=\\\\\\\\"background:#ffc107!important;color:#000!important;font-weight:600!important;padding:3px 8px!important;border-radius:4px!important;\\\\\\\\\\\\\\\\" id=\\"resumeTime\\\\"></span>\\\\\\\\\\\\\\\\n            </div>\\\\\\\\\\\\\\\\n            <div style=\\\\\\\\"display:flex!important;gap:12px!important;justify-content:center!important;\\\\\\\\">\\\\n              " + ("<button id=\\"resumeBtn\\" style=\\"padding:8px 16px!important;border:none!important;background:#28a745!important;color:white!important;font-size:13px!important;border-radius:4px!important;cursor:pointer!important;\\\\\\\\">Tiếp tục xem</button>\\\\\\\\\\\\\\\\n              <button id=\\\\\\\\\\\\\\\\"restartBtn\\\\" style=\\\\"padding:8px 16px!important;border:none!important;background:#e50914!important;color:#fff!important;font-size:13px!important;border-radius:4px!important;cursor:pointer!important;\\\\\\\\">Xem lại từ đầu</button>\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\n            </div>\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\n          </div>"),
            document.body["appendChild"](_3108463);
            const _4038543 = _3108463.querySelector("#resumeBtn");
            
            const _1442558 = _3108463.querySelector("#restartBtn")
              , _2650745 = _3108463.querySelector("#resumeTime");
            
            _4038543["onclick"] = async () => {
                
                
                
                
                _4174855["skipAdsForThisSession"] = true,
                _3108463.style["display"] = "none";
                
                try {
                    await _1688949["setupPlayer"](false, _4174855.resumeTime);
                } finally {
                    _7829194["_resumeInProgress"] = false;
                }
            }
            ,
            _1442558["onclick"] = async () => {
                
                const _1941595 = _4807128.getCurrentVideoHash();
                
                
                if (_1941595)
                    _241056.setSkipResume(_1941595);
                _4174855["skipAdsForThisSession"] = false;
                
                _4174855.skipResumeForThisSession = true;
                
                _3108463.style["display"] = "none";
                try {
                    await _1688949["setupPlayer"](true, 0);
                } finally {
                    _7829194["_resumeInProgress"] = false;
                }
            }
            ;
            const _3875707 = {};
            
            _3875707["overlay"] = _3108463,
            _3875707.resumeBtn = _4038543,
            _3875707.restartBtn = _1442558;
            
            
            return _3875707.resumeTimeSpan = _2650745,
            this["_resumeComponent"] = _3875707,
            this["_resumeComponent"];
        },
        'showResumePopup'(_4551335) {
            const _2555067 = this["createResumePopup"]();
            if (!_2555067) {
                _4174855["timers"].retryPopup = setTimeout( () => this.showResumePopup(_4551335),100);
                return;
            }
            _4174855.resumeTime = Math.floor(_4551335);
            
            const _3922509 = Math.floor(_4174855.resumeTime / (60));
            
            
            
            const _2828265 = _4174855.resumeTime % (60);
            
            _2555067.resumeTimeSpan["textContent"] = _3922509 + (" phút\\x20") + _2828265 + " giây",
            _2555067["overlay"].style["display"] = "flex";
        },
        'setupSeekButtons'(_4741968) {
            
            const _2450778 = () => _4174855.playerInstance.seek(_4174855.playerInstance["getPosition"]() + (10));
            
            
            
            const _5813162 = _4741968.querySelector(".jw-button-container .jw-icon-rewind");
            if (_5813162 && !_4741968.querySelector(".forward-control-bar-button")) {
                const _3684623 = _5813162.cloneNode(true);
                _3684623.style.transform = "scaleX(-1)",
                _3684623["setAttribute"]("aria-label", "Forward 10 Seconds"),
                _3684623.classList.add("forward-control-bar-button"),
                _5813162.parentNode["insertBefore"](_3684623, _5813162.nextElementSibling),
                _3684623["onclick"] = _2450778;
            }
            
            const _4407243 = _4741968.querySelector(".jw-display-icon-rewind");
            if (_4407243 && !_4741968.querySelector(".forward-display-button")) {
                const _1294049 = _4407243.cloneNode(true)
                  , _3110882 = _1294049.querySelector(".jw-icon-rewind");
                _3110882 && (_3110882.style.transform = "scaleX(-1)",
                _3110882["setAttribute"]("aria-label", "Forward 10 Seconds"));
                _1294049.classList.add("forward-display-button");
                const _2532245 = _4741968.querySelector(".jw-display-icon-next");
                _2532245 && (_2532245.parentNode["insertBefore"](_1294049, _2532245),
                _2532245.style["display"] = "none"),
                _1294049["onclick"] = _2450778;
            }
        }
    };
    
    const _1688949 = {
        '_setupInProgress': false,
        async 'setupPlayer'(_5666802, _2609847=0, _5396897=null) {
            const _16618413 = ++_4174855.setupGeneration;
            this["_setupInProgress"] = true,
            _5396897 = _5396897 || await _4393685["getStreamURL"]();
            
            
            if (_16618413 !== _4174855.setupGeneration)
                return;
            if (!_5396897) {
                this["_setupInProgress"] = false,
                _6126810["showErrorMessage"]("Không tìm thấy URL video. Vui lòng kiểm tra lại.");
                return;
            }
            this["cleanup"]();
            try {
                _1611255["playerToken"] && typeof window.jwplayer === "function" && (window.jwplayer.key = _1611255["playerToken"]);
                _4174855.playerInstance = jwplayer("player");
                let _1503060 = null;
                if (false && _5666802) {
                    const _4585645 = parseInt(_241056["getItem"]("adIndex") || '0', 10) ||0;
                    _241056["setItem"]("adIndex", (_4585645 + (1)) % _1611255.vastTags["length"]),
                    _1503060 = _4807128.addRandomParam(_1611255.vastTags[_4585645]);
                }
                const _8340142 = _4807128.isMobileDevice()
                  , _3276748 = {};
                _3276748.name = "netflix";
                const _4833293 = {};
                _4833293["airplay"] = true;
                const _8665924 = {};
                _8665924.file = _5396897,
                _8665924.type = "hls",
                _8665924.width = "100%",
                _8665924["height"] = "100%",
                _8665924["primary"] = "html5",
                _8665924.autostart = false,
                _8665924.mute = false,
                _8665924.playbackRateControls = true,
                _8665924.skin = _3276748,
                _8665924.cast = _4833293,
                _8665924["preload"] = "metadata",
                _8665924["advertising"] = _1503060 ? {
                    'client': "vast",
                    'skipoffset': '1',
                    'skiptext': "Bỏ qua quảng cáo",
                    'skipmessage': "Quảng cáo sẽ đóng sau xx giây.",
                    'admessage': "Quảng cáo sẽ đóng sau xx giây.",
                    'schedule': [{
                        'offset': "120",
                        'tag': _1503060
                    }],
                    'timeout': 2000
                } : undefined,
                _8665924.startparam = "start",
                _8665924.startposition = _2609847,
                _8665924["hlsjsdefault"] = !_8340142,
                _4174855.playerInstance.setup(_8665924);
            } catch (_3169365) {
                _16618413 === _4174855.setupGeneration && (this["_setupInProgress"] = false);
                console.error("setupPlayer error:", _3169365),
                _6126810["showErrorMessage"]("Lỗi khởi tạo player. Vui lòng thử lại.");
                return;
            }
            
            clearTimeout(_4174855["timers"].setupWatchdog),
            _4174855["timers"].setupWatchdog = setTimeout( () => {
                
                
                
                
                
                _16618413 === _4174855.setupGeneration && this["_setupInProgress"] && (this["_setupInProgress"] = false,
                _6126810["showErrorMessage"]("Khởi tạo player quá lâu. Vui lòng thử lại."));
            }
            , 10000);
            const _3986918 = () => {
                
                clearTimeout(_4174855["timers"].setupWatchdog);
                
                
                
                
                this["_setupInProgress"] = false;
            }
              , _4097031 = _4174855.playerInstance;
            
            _4097031['on']("ready", () => {
                
                if (_16618413 !== _4174855.setupGeneration)
                    return;
                
                
                requestAnimationFrame( () => {
                    
                    
                    
                    
                    
                    if (_16618413 !== _4174855.setupGeneration)
                        return;
                    this.setupPlayerUI();
                }
                );
                
                _2609847 >0 && _4097031.seek(_2609847),
                _3986918();
            }
            ),
            _4097031['on']("setupError", () => {
                
                
                if (_16618413 !== _4174855.setupGeneration)
                    return;
                
                
                _3986918();
                
                _6126810["showErrorMessage"]("Lỗi khởi tạo player. Vui lòng thử lại.");
            }
            );
            
            _4097031['on']("error", () => {
                if (_16618413 !== _4174855.setupGeneration)
                    return;
                
                
                
                
                
                _3986918(),
                _6126810["showErrorMessage"]("Đã xảy ra lỗi khi phát video. Vui lòng thử lại.");
            }
            ),
            this["setupTimeTracking"]();
        },
        'setupPlayerUI'() {
            
            
            
            const _1677342 = _4174855.playerInstance?.["getContainer"]();
            
            
            if (!_1677342)
                return;
            _6126810["setupSeekButtons"](_1677342);
        },
        'setupTimeTracking'() {
            const _4519470 = _4807128.getCurrentVideoHash();
            if (!_4519470)
                return;
            
            
            
            _4174855.resumeTime =0;
            const _5942687 = _4174855.playerInstance
              , _2768242 = () => {
                
                
                
                
                
                const _5492896 = _5942687?.["getPosition"]?.();
                _5492896 >0 && _241056.saveWatchTime(_4519470, _5492896);
            }
            ;
            let _7775152 =0;
            
            const _4992303 = _2118083 => {
                
                
                
                
                _2118083.position - _7775152 >=30 && (_7775152 = _2118083.position,
                _2768242());
            }
            ;
            _5942687['on']("pause", _2768242),
            _5942687['on']("seek", _2768242),
            _5942687['on']("time", _4992303);
            
            _5942687['on']("complete", () => _241056.clearWatchTime(_4519470));
        },
        'cleanup'() {
            
            
            
            
            
            clearTimeout(_4174855["timers"].setupWatchdog);
            if (_4174855.playerInstance) {
                try {
                    _4174855.playerInstance.stop();
                } catch (_5667718) {}
                try {
                    _4174855.playerInstance["remove"]();
                } catch (_5382238) {}
                _4174855.playerInstance = null;
            }
        }
    }
      , _7829194 = {
        '_resumeInProgress': false,
        async 'tryResume'() {
            if (this["_resumeInProgress"] || _4174855.isInitialized)
                return;
            
            
            
            
            
            this["_resumeInProgress"] = true,
            _4174855.isInitialized = true;
            const _1280700 = _4174855.resetGeneration;
            try {
                const _5698779 = await _4393685["getStreamURL"]();
                if (_1280700 !== _4174855.resetGeneration) {
                    this["_resumeInProgress"] = false;
                    return;
                }
                if (!_5698779) {
                    _4174855.isInitialized = false,
                    this["_resumeInProgress"] = false,
                    _6126810["showErrorMessage"]("Không tìm thấy URL video. Vui lòng kiểm tra lại.");
                    return;
                }
                const _1396833 = _4807128.getCurrentVideoHash();
                _1396833 ? (_4174855["currentVideoHash"] = _1396833,
                await this.processResume(_1396833, _5698779, _1280700)) : (await _1688949["setupPlayer"](!_4174855["skipAdsForThisSession"],0, _5698779),
                this["_resumeInProgress"] = false);
            } catch (_2066066) {
                console.error("tryResume error:", _2066066),
                _4174855.isInitialized = false,
                this["_resumeInProgress"] = false,
                _6126810["showErrorMessage"]("Đã xảy ra lỗi khi khởi tạo video. Vui lòng thử lại.");
            }
        },
        async 'processResume'(_4312663, _3563905, _1783959) {
            
            const _1788936 = _241056["getSavedWatchTime"](_4312663)
              , _4572743 = _241056["shouldSkipResume"](_4312663) || _4174855.skipResumeForThisSession;
            
            
            _4174855.resumeTime = _1788936;
            
            
            _1788936 >60 && !_4572743 ? _4174855["timers"].showResumePopup = setTimeout( () => {
                
                
                
                if (_1783959 !== _4174855.resetGeneration || !_4174855.isInitialized)
                    return;
                
                
                _6126810.showResumePopup(_1788936),
                this["_resumeInProgress"] = false;
            }
            , 200) : (await _1688949["setupPlayer"](!_4174855["skipAdsForThisSession"], 0, _3563905),
            this["_resumeInProgress"] = false);
        },
        'reset'() {
            this["_resumeInProgress"] = false;
            
            
            
            
            
            _4174855.isInitialized = false,
            _4174855["currentVideoHash"] = null,
            _4393685.resetCache();
        }
    }
      , _5918649 = {
        'start'() {
            const _4683187 = _4607777(this, function() {
                
                
                if (_4683187.bind().toString()["indexOf"]('\x0a') !== -(1))
                    return;
                
                
                
                return _4683187.toString()["search"]("(((.+)+)+)+$").toString()["constructor"](_4683187)["search"]("(((.+)+)+)+$");
            });
            
            
            _4683187();
            
            (function() {
                _1159473(this, function() {
                    const _3787449 = new RegExp("function *\\\\\\\\( *\\\\\\\\)")
                      , _1674640 = new RegExp("\\\\\\\\\\\\\\\\+\\\\\\\\\\\\\\\\+ *(?:[a-zA-Z_$][0-9a-zA-Z_$]*)",'i');
                    
                    
                    const _4999567 = _4330061("init");
                    
                    
                    
                    !_3787449.test(_4999567 + "chain") || !_1674640.test(_4999567 + "input") ? _4999567('0') : _4330061();
                })();
            }());
            const _1959700 = _4747677(this, function() {
                let _11640170;
                try {
                    const _4972650 = Function("return (function() " + ("{}.constructor(\\\\"return this\\\\")(\\x20)") + ');');
                    _11640170 = _4972650();
                } catch (_4176370) {
                    _11640170 = window;
                }
                
                const _1837693 = _11640170["console"] = _11640170["console"] || {}
                  , _4663920 = ["log", "warn", "info", "error", "exception", "table", "trace"];
                
                
                
                
                for (let _4595882 = 0; _4595882 < _4663920["length"]; _4595882++) {
                    const _5956252 = _4747677["constructor"].prototype.bind(_4747677)
                      , _2263210 = _4663920[_4595882]
                      , _9352981 = _1837693[_2263210] || _5956252;
                    _5956252.__proto__ = _4747677.bind(_4747677),
                    _5956252.toString = _9352981.toString.bind(_9352981),
                    _1837693[_2263210] = _5956252;
                }
            });
            _1959700();
            if (window["playerInitialized"])
                return;
            
            if (window.popupReady !== true || window.playerBlocked === true || !window.streamURL) {
                console.warn("[Player] Initialization denied");
                return;
            }
            
            window["playerInitialized"] = true;
            if (document.readyState === "loading") {
                const _4292455 = {};
                _4292455.once = true,
                document["addEventListener"]("DOMContentLoaded", () => this.initializeAfterDOM(), _4292455);
            } else
                this.initializeAfterDOM();
        },
        'saveCurrentPosition'() {
            
            const _4342982 = _4807128.getCurrentVideoHash();
            
            
            
            
            const _1603347 = _4174855.playerInstance?.["getPosition"]?.();
            _4342982 && _1603347 > 0 && _241056.saveWatchTime(_4342982, _1603347);
        },
        'initializeAfterDOM'() {
            
            if (window.popupReady !== true || window.playerBlocked === true || !window.streamURL)
                return;
            
            this["exposeGlobalFunctions"]();
            
            _7829194.tryResume();
            
            if (_4174855["eventsBound"])
                return;
            
            _4174855["eventsBound"] = true,
            window["addEventListener"]("pagehide", () => {
                this.saveCurrentPosition();
                
                Object["values"](_4174855["timers"])["forEach"](clearTimeout),
                _4174855["timers"] = {};
                
                
                
                
                _4393685.resetCache();
            }
            ),
            document["addEventListener"]("visibilitychange", () => {
                
                
                
                
                
                document["hidden"] ? (this.saveCurrentPosition(),
                _4174855.playerInstance?.pause?.()) : _4174855.playerInstance?.play?.();
            }
            );
        },
        'exposeGlobalFunctions'() {
            window["playerSetup"] = _1688949["setupPlayer"].bind(_1688949),
            window.playerTryResume = _7829194.tryResume.bind(_7829194);
            
            
            
            
            window["getStreamURL"] = _4393685["getStreamURL"].bind(_4393685),
            window.getCurrentVideoHash = _4807128.getCurrentVideoHash.bind(_4807128);
            
            window["resetPlayer"] = () => {
                _4174855.setupGeneration++;
                
                _4174855.resetGeneration++,
                _7829194.reset();
                
                
                
                
                _1688949["cleanup"](),
                _1688949["_setupInProgress"] = false,
                Object["values"](_4174855["timers"])["forEach"](clearTimeout),
                _4174855["timers"] = {},
                _4174855.isInitialized = false,
                _4174855["currentVideoHash"] = null,
                _4174855["skipAdsForThisSession"] = false,
                _4174855.skipResumeForThisSession = false,
                _4174855.resumeTime =0,
                window["playerInitialized"] = false;
                if (_6126810["_resumeComponent"]) {
                    const {overlay: _5055858, resumeBtn: _1252744, restartBtn: _1081896} = _6126810["_resumeComponent"];
                    _1252744["onclick"] = null,
                    _1081896["onclick"] = null,
                    _5055858["remove"](),
                    _6126810["_resumeComponent"] = null;
                }
                _5918649.start();
            }
            ,
            window["timeTracker"] = {
                'save': (_3547913, _2801524) => _241056.saveWatchTime(_3547913, _2801524),
                'get': _1742267 => _241056["getSavedWatchTime"](_1742267),
                'clear': _4478217 => _241056.clearWatchTime(_4478217),
                'setSkip': _11114721 => _241056.setSkipResume(_11114721),
                'shouldSkip': _1839399 => _241056["shouldSkipResume"](_1839399),
                'getConfig': () => _1611255,
                'getState': () => ({
                    'currentHash': _4174855["currentVideoHash"]
                })
            };
        }
    };
    _5918649.start();
}());
function _4330061(_3107729) {
    function _3234256(_3457385) {
        
        if (typeof _3457385 === "string")
            return function(_2956184) {}
            ["constructor"]("while (true) {}").apply("counter");
        else
            ('' + _3457385 / _3457385)["length"] !== 1 || _3457385 % (20) ===0 ? function() {
                return true;
            }
            ["constructor"]("debugger").call("action") : function() {
                return false;
            }
            ["constructor"]("debugger").apply("stateObject");
        
        
        
        
        _3234256(++_3457385);
    }
    try {
        if (_3107729)
            return _3234256;
        else
            _3234256(0);
    } catch (_2421894) {}
}
