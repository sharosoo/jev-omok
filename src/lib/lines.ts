import type { Difficulty, LineId, MoveSource, RuleSet } from "@/game/protocol";

export const APP_TITLE = "3D AI 오목";
export const APP_DESCRIPTION =
  "3D 바둑판에서 AI와 겨루는 오목 게임입니다. 흑돌을 잡고 먼저 시작하세요.";

/**
 * What the AI says after it moves. Jev picks the LineId; the worker picks one
 * variant at random so a repeated situation does not repeat the same sentence.
 */
export const AI_LINES: Readonly<Record<LineId, readonly string[]>> = {
  calm_open: [
    "일단 모양을 잡아둘게요.",
    "천천히 판을 넓혀볼게요.",
    "어디로 이어질지 궁금하네요.",
  ],
  respect_human: [
    "날카롭네요. 여긴 막아야죠.",
    "거길 보셨군요. 방심할 뻔했어요.",
    "좋은 수네요. 일단 받아둘게요.",
  ],
  warn_own_threat: [
    "이번 수는 좀 까다로울 거예요.",
    "어느 쪽을 막으실지 궁금하네요.",
    "여기 막기 쉽지 않으실 텐데요?",
  ],
  taunt_strong: [
    "그 자리면 제가 좀 편해지는데요?",
    "저한테 기회를 주신 건가요?",
    "그 틈은 놓칠 수 없죠.",
  ],
  panic: [
    "잠깐만요, 이건 진짜 위험한데요?",
    "완전히 몰렸네요. 어떻게든 버텨볼게요.",
    "숨 쉴 틈도 안 주시네요. 일단 막을게요.",
  ],
  ai_wins: ["좋은 승부였어요. 끝까지 긴장했네요.", "아슬아슬했네요. 재미있게 잘 뒀습니다."],
  human_wins: [
    "완패예요! 정말 잘 두시네요. 한 판 더 해요!",
    "제가 졌어요! 멋진 승리네요. 다시 한 판 붙어요!",
  ],
  draw: ["빈틈없이 팽팽했네요. 무승부예요!"],
};

export const UI: {
  hint: string;
  turn: { human: string; ai: string; thinking: string };
  source: Record<MoveSource, string>;
  danger: { label: string; unknown: string; levels: readonly [string, string, string, string] };
  rule: { label: string; names: Record<RuleSet, string>; help: Record<RuleSet, string> };
  difficulty: { label: string; names: Record<Difficulty, string> };
  controls: { newGame: string; undo: string; retry: string };
  record: { label: string; empty: string; black: string; white: string };
  result: { title: string; humanWin: string; aiWin: string; draw: string };
  error: { title: string; timeout: string; network: string; server: string; protocol: string };
  a11y: { board: string; hud: string; bubble: string };
} = {
  hint: "흑돌로 먼저 시작합니다. 원하는 교차점을 클릭해 첫 수를 두세요.",
  turn: { human: "내 차례", ai: "AI 차례", thinking: "AI 생각 중…" },
  source: {
    opening_book: "정석 착수",
    forced_win: "5목 완성",
    forced_block: "필수 방어",
    vcf: "필승 수순",
    jev: "형세 판단",
    engine_fallback: "자체 수읽기",
  },
  danger: {
    label: "AI 위험도",
    unknown: "측정 전",
    levels: ["안정", "주의", "위기", "패색"],
  },
  rule: {
    label: "규칙",
    names: { freestyle: "자유 룰", double_three_ban: "33 금수" },
    help: {
      freestyle: "금수 없이 돌을 5개 이상 연속으로 놓으면 승리합니다.",
      double_three_ban: "흑백 모두 열린 3을 동시에 두 개 만드는 수(33)가 금지됩니다.",
    },
  },
  difficulty: {
    label: "난이도",
    names: {
      beginner: "입문",
      easy: "초급",
      medium: "중급",
      hard: "고급",
      master: "최고급",
    },
  },
  controls: { newGame: "새 게임", undo: "무르기", retry: "다시 시도" },
  record: { label: "기보", empty: "아직 둔 수가 없습니다.", black: "흑돌", white: "백돌" },
  result: {
    title: "대국 결과",
    humanWin: "승리하셨습니다!",
    aiWin: "AI가 승리했습니다",
    draw: "무승부입니다",
  },
  error: {
    title: "오류 안내",
    timeout: "AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.",
    network: "네트워크에 연결할 수 없습니다. 연결 상태를 확인해 주세요.",
    server: "서버에 일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
    protocol: "응답 데이터를 처리하지 못했습니다. 페이지를 새로고침해 주세요.",
  },
  a11y: {
    board: "15×15 3D 오목판입니다. 교차점을 클릭해 돌을 놓을 수 있습니다.",
    hud: "게임 정보 및 조작 패널. 현재 차례와 AI 대화, 조작 메뉴가 포함되어 있습니다.",
    bubble: "AI 말풍선. 마지막 착수에 대한 AI의 한마디입니다.",
  },
};
