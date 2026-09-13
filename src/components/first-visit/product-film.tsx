"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import styles from "./product-landing.module.css";
function subscribe(listener: () => void) {
  const queries = [matchMedia("(prefers-reduced-motion: reduce)"), matchMedia("(max-width: 640px)")];
  queries.forEach(query => query.addEventListener("change", listener));
  return () => queries.forEach(query => query.removeEventListener("change", listener));
}
function mediaState() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return `${matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop"}:${matchMedia("(prefers-reduced-motion: reduce)").matches || connection?.saveData ? "still" : "motion"}`;
}
/** Recorded public demo only; no private request or chart bundle on landing. */
export function ProductFilm() {
  const preferences = useSyncExternalStore(subscribe, mediaState, () => "desktop:still");
  const frame = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pausedByUser = useRef(false);
  const [visible, setVisible] = useState(false);
  const [requested, setRequested] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const source = visible && (preferences === "desktop:motion" || requested) && !failed
    ? `/product-demo/varda-${preferences.startsWith("mobile") ? "mobile" : "desktop"}.webm` : undefined;
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false), { threshold: 0.15 });
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    if (!visible || !source || pausedByUser.current) player.pause();
    else void player.play().catch(() => {});
  }, [source, visible]);
  function toggle() {
    if (playing) { pausedByUser.current = true; video.current?.pause(); }
    else { pausedByUser.current = false; setRequested(true); void video.current?.play().catch(() => {}); }
  }
  return <figure ref={frame} className={styles.film} aria-label="실제 Cairn Labs 샘플 화면 사용 영상">
    <div className={styles.filmTop}><span><i aria-hidden="true" /> CAIRN LABS / PRODUCT TOUR</span><span>가상 포트폴리오로 촬영한 실제 화면</span></div>
    <div className={styles.screen}>
      <picture><source media="(max-width: 640px)" srcSet="/product-demo/poster-mobile.png" />
        {/* Native picture chooses one captured viewport without downloading both. */}
        <img src="/product-demo/poster-desktop.png" alt="Cairn Labs 샘플 포트폴리오의 자산 배분과 종목별 비중 화면" width={1280} height={800} fetchPriority="high" />
      </picture>
      <video ref={video} src={source} muted playsInline loop preload="none" aria-label="오늘 변동, 포트 구조, 투자 랩, 시뮬레이션을 살펴보는 제품 영상" aria-describedby="product-film-description" className={source && ready && !failed ? styles.videoReady : styles.videoHidden} onLoadStart={() => setReady(false)} onLoadedData={() => setReady(true)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setFailed(true); setPlaying(false); }} />
      {!failed ? <button className={styles.play} onClick={toggle} aria-label={playing ? "제품 영상 일시정지" : "제품 영상 재생"}>{playing ? <Pause size={15} /> : <Play size={15} />}<span>{playing ? "일시정지" : "영상으로 둘러보기"}</span></button> : <span className={styles.filmFailure}>영상 대신 실제 화면을 보여드리고 있어요.</span>}
    </div><figcaption id="product-film-description">오늘 변동 → 포트 구조 → 투자 랩 → 시뮬레이션. 예시 결과는 투자 추천이나 수익 예측이 아닙니다.</figcaption>
  </figure>;
}
