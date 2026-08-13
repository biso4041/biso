/* =============================================================
   pb-store.js — 관리자 페이지 저장소
   · 설정(이벤트/후기/사진 목록)은 localStorage
   · 사진·영상 파일은 IndexedDB (용량이 커서 localStorage로는 부족)
   ============================================================= */
(function () {
  var DB_NAME = 'pb_media', STORE = 'files', VER = 1;
  var urlCache = {};
  var dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, VER);
      r.onupgradeneeded = function () {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }

  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, mode), s = t.objectStore(STORE), out;
        out = fn(s);
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }

  /* ---------- 이미지 축소 (원본 그대로 올려도 되게) ---------- */
  function shrinkImage(file, maxW) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        var w = im.naturalWidth, h = im.naturalHeight;
        if (w <= maxW) { URL.revokeObjectURL(url); res(file); return; }
        var nh = Math.round(h * maxW / w);
        var c = document.createElement('canvas');
        c.width = maxW; c.height = nh;
        c.getContext('2d').drawImage(im, 0, 0, maxW, nh);
        c.toBlob(function (b) { URL.revokeObjectURL(url); res(b || file); }, 'image/jpeg', 0.85);
      };
      im.onerror = function () { URL.revokeObjectURL(url); res(file); };
      im.src = url;
    });
  }

  var PB = {
    K: { hero: 'pb_hero', reviews: 'pb_reviews', gallery: 'pb_gallery', volunteer: 'pb_volunteer' },

    DEFAULTS: {
      gallery: [
        { id: 'g1', src: 'images/event-2.jpg' },
        { id: 'g2', src: 'images/event-3.jpg' },
        { id: 'g3', src: 'images/event-4.jpg' },
        { id: 'g4', src: 'images/event-5.jpg' }
      ],
      volunteer: [],
      reviews: [
        { id: 'r1', on: true, tag: '퍼스널컬러 + 체형진단', who: '네이버 방문자 리뷰 · 똥이양 님', photo: '',
          text: '예약제로 운영되어 다른 사람 눈치 보지 않고 편안하게 상담받을 수 있었어요. 퍼스널컬러의 기본 개념부터 알려주셔서 이해하기 쉬웠고, 저에게 맞는 컬러와 분위기를 콕 집어주셔서 너무 알찬 시간이었어요. 옷이나 화장품을 고를 때 기준이 생겨 훨씬 자신감이 생겼습니다!' },
        { id: 'r2', on: true, tag: '퍼스널컬러 진단', who: '네이버 방문자 리뷰 · 호톤이 님', photo: '',
          text: '1시간이 어떻게 지나갔는지 모를 만큼 재미있고, 저를 알아가는 시간이어서 좋았어요. 원장님 완전 전문가이십니다. 얼굴 이미지 분석해서 눈썹 수정도 해주신다고 하니 참고해서 방문하세요!' },
        { id: 'r3', on: true, tag: '눈썹 반영구', who: '네이버 방문자 리뷰 · Soonaa 님', photo: '',
          text: '앞머리가 거의 없는 짧은 눈썹이라 평소 고민이 많았는데, 얼굴형과 분위기에 맞춰 제 장점을 살린 디자인으로 정말 자연스럽고 예쁜 눈썹이 완성됐어요. 관리 과정에서도 작은 부분 하나까지 꼼꼼하게 체크해주셨어요.' }
      ]
    },

    uid: function () { return 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); },

    read: function (k, fb) {
      try { var v = JSON.parse(localStorage.getItem(k)); return v === null ? fb : v; }
      catch (e) { return fb; }
    },
    write: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { alert('저장 공간이 부족합니다. 사진을 줄여주세요.'); } },

    ensure: function (k, defaults) {
      var v = PB.read(k, null);
      return v === null ? JSON.parse(JSON.stringify(defaults)) : v;
    },
    ensureReviews: function () { return PB.ensure(PB.K.reviews, PB.DEFAULTS.reviews); },
    getHero: function () { return PB.read(PB.K.hero, { img: '', video: '', videoOff: false }); },

    /* ---------- 파일 저장 / 불러오기 ---------- */
    saveFile: function (file, id) {
      var p = (file.type.indexOf('image/') === 0) ? shrinkImage(file, 1600) : Promise.resolve(file);
      return p.then(function (blob) {
        return tx('readwrite', function (s) { s.put(blob, id); }).then(function () {
          PB.clearURL(id);
          return id;
        });
      });
    },

    mediaURL: function (id) {
      if (!id) return Promise.resolve('');
      if (urlCache[id]) return Promise.resolve(urlCache[id]);
      return tx('readonly', function (s) { return s.get(id); }).then(function (blob) {
        if (!blob) return '';
        urlCache[id] = URL.createObjectURL(blob);
        return urlCache[id];
      }).catch(function () { return ''; });
    },

    clearURL: function (id) {
      if (urlCache[id]) { try { URL.revokeObjectURL(urlCache[id]); } catch (e) {} delete urlCache[id]; }
    },

    delMedia: function (id) {
      if (!id) return Promise.resolve();
      return tx('readwrite', function (s) { s.delete(id); });
    },

    allMediaKeys: function () {
      return tx('readonly', function (s) { return s.getAllKeys(); }).then(function (k) { return k || []; })
        .catch(function () { return []; });
    },

    /* ---------- 백업 / 복원 ---------- */
    exportAll: function () {
      var settings = {};
      ['pb_cms', 'pb_cms_img', 'pb_event', PB.K.hero, PB.K.reviews, PB.K.gallery, PB.K.volunteer]
        .forEach(function (k) { var v = localStorage.getItem(k); if (v !== null) settings[k] = v; });

      return PB.allMediaKeys().then(function (keys) {
        return keys.reduce(function (p, k) {
          return p.then(function (acc) {
            return tx('readonly', function (s) { return s.get(k); }).then(function (blob) {
              if (!blob) return acc;
              return new Promise(function (res) {
                var rd = new FileReader();
                rd.onload = function () { acc[k] = rd.result; res(acc); };
                rd.onerror = function () { res(acc); };
                rd.readAsDataURL(blob);
              });
            });
          });
        }, Promise.resolve({}));
      }).then(function (media) { return { settings: settings, media: media }; });
    },

    importAll: function (data) {
      if (!data) return Promise.resolve();
      var settings = data.settings || data;
      Object.keys(settings).forEach(function (k) {
        if (typeof settings[k] === 'string') localStorage.setItem(k, settings[k]);
      });
      var media = data.media || {};
      return Object.keys(media).reduce(function (p, k) {
        return p.then(function () {
          return fetch(media[k]).then(function (r) { return r.blob(); })
            .then(function (b) { PB.clearURL(k); return tx('readwrite', function (s) { s.put(b, k); }); });
        });
      }, Promise.resolve());
    }
  };

  window.PB = PB;
})();
