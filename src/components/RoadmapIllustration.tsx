import type { StageId } from "../campaign/types";

/** Small ink drawings in the travel book, deliberately free of puzzle solutions. */
export function RoadmapIllustration({ chapter }: { chapter: StageId }) {
  return <svg className={`roadmap-illustration illustration-${chapter}`} viewBox="0 0 180 130" fill="none" aria-hidden="true">
    <ellipse cx="90" cy="76" rx="72" ry="45" fill="currentColor" opacity=".07" />
    <path d="M12 116Q48 102 83 113T170 112" stroke="currentColor" strokeWidth="1.5" opacity=".4" />
    <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {chapter === 1 && <><path d="M46 110V55a44 44 0 0 1 88 0v55M59 110V57a31 31 0 0 1 62 0v53" /><path d="M60 110h62M81 113l-10 12M105 113l10 12M90 18v13M53 33l11 9M126 33l-11 9" /><path d="M79 98V64a12 12 0 0 1 24 0v34" fill="currentColor" opacity=".2" /><path d="M34 94q-14-23-15-3 14 0 15 19M143 88q15-20 17-2-13 3-17 23" /></>}
      {chapter === 2 && <><path d="M30 75V46q0-20 20-20h80q20 0 20 20v29M51 72V42M129 72V42M23 88q12-8 25 0t25 0 25 0 25 0 25 0M20 105q12-8 25 0t25 0 25 0 25 0 25 0" /><path d="M68 82l-5-25 40-5 5 25zM68 57l39 20M87 24l-4 9M112 23l-4 9M36 12l-4 9" /><path d="M118 83h35l-7 10h-24z" fill="currentColor" opacity=".15" /></>}
      {chapter === 3 && <><path d="M41 111V70a43 43 0 0 1 86 0v41zM54 111V83a29 29 0 0 1 58 0v28M111 36V14h22v81M37 68h91" /><circle cx="79" cy="47" r="15" /><path d="M79 36v11l8 5M62 103q-9-13 3-23-2 13 9 17 6-12 10-14 12 15 2 20M143 39q-10-9 0-17M151 62q-10-9 0-17" /></>}
      {chapter === 4 && <><path d="M31 95h42l8 18H45zM40 94V69h53l17 11-31 8v6M111 115V65M93 67h40M111 65V42" /><circle cx="111" cy="37" r="5" /><path d="M110 31q-28-28-34-8l28 15M118 36q31-20 26-32l-30 26M110 43q10 36 26 24l-19-28M26 41q22-13 44 0M18 51q22-13 44 0" /></>}
      {chapter === 5 && <><path d="M24 22h132M33 25q-4 25 11 37t0 32M148 23q-15 18-5 33t-3 39M67 23l7 28h32l7-28M90 51v31M90 74q-24-22-23-4 8 10 23 12M90 66q22-25 25-7-7 13-25 17M70 107l19 12 21-12M90 119V96" /><path d="M31 58q-18-14-15 0 7 8 15 0M145 66q21-13 17 1-8 6-17-1" fill="currentColor" opacity=".2" /></>}
      {chapter === 6 && <><path d="M24 43h132M24 100h132M37 43V18h106v82M51 56h24v28H51zM55 56v-8q8-12 16 0v8M63 63q-10 11 0 15 10-4 0-15" /><path d="M91 72h18v13q-9 10-18 0zM109 75q15-1 10 9h-10M127 77h15v11q-8 8-15 0zM142 79q11 0 9 8h-9" /><path d="M28 111l24 5M124 112l19-5" /></>}
      {chapter === 7 && <><path d="M22 24h136v89M22 24v89M24 27q34 13 23 53L24 97M155 27q-34 13-23 53l23 17M21 116h139M67 29v23M110 29v23" /><circle cx="67" cy="62" r="10" /><circle cx="110" cy="62" r="10" /><path d="M67 73v21l-10 18M67 94l10 18M51 80l16-4 16 4M110 73v21l-10 18M110 94l10 18M94 80l16-4 16 4M85 12l6 7 6-7" /></>}
      {chapter === 8 && <><path d="M82 114V30M75 30h14M83 34l42-13v25L83 41M36 96q27-13 56 0t61 0M20 111q32-13 63 0t74 0M34 75q19-10 36-2M99 72q22-11 46-2" /><path d="M50 59l-7-13M42 62l-17-3M52 49l2-16" /><circle cx="49" cy="65" r="4" /></>}
      {chapter === 9 && <><path d="M60 116V44h60v72M51 44l39-29 39 29zM68 16V7M112 16V7M80 116V89h20v27M63 78h54" /><path d="M78 68q3-6 3-17 9-14 18 0 0 11 3 17zM88 72h4M50 115H34M130 115h16" /><path d="M40 46q-11 13 0 27M139 46q11 13 0 27" opacity=".5" /></>}
      {chapter === 10 && <><path d="M48 115V35q42-36 84 0v80M64 114V44q26-24 52 0v70M90 30v82" /><circle cx="90" cy="57" r="6" /><circle cx="90" cy="77" r="6" /><circle cx="90" cy="97" r="6" /><path d="M24 109V82l12-9 7 14-9 20M148 109V82l-12-9-7 14 9 20M74 9h32" /><path d="M72 114h36" strokeWidth="5" /></>}
    </g>
    <g fill="currentColor" opacity=".5"><circle cx="23" cy="29" r="1.5" /><circle cx="158" cy="57" r="2" /><circle cx="137" cy="10" r="1.5" /></g>
  </svg>;
}
