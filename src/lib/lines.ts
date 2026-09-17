import type { Difficulty, LineId, MoveSource, RuleSet } from "@/game/protocol";
import type { EndReason, Seat, ServerErrorCode } from "@/game/realtime";

export const APP_TITLE = "3D 오목";
export const APP_DESCRIPTION =
  "3D 바둑판에서 말을 건네는 AI와 두거나 실시간으로 다른 사람과 맞붙습니다. 흑을 잡고 먼저 둡니다.";

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
  landing: {
    tagline: string;
    nav: { play: string; pvp: string; profile: string };
    entries: Record<"ai" | "pvp" | "profile", { label: string; desc: string }>;
    leaderboard: { title: string; caption: string };
  };
  auth: {
    signIn: string;
    signOut: string;
    guest: string;
    callback: { waiting: string; errorTitle: string; errorBody: string; retry: string };
  };
  profile: {
    title: string;
    guest: { title: string; body: string; cta: string };
    stats: {
      wins: string;
      losses: string;
      draws: string;
      played: string;
      streak: string;
      bestStreak: string;
    };
    recent: {
      title: string;
      empty: string;
      opponent: string;
      seat: string;
      result: string;
      reason: string;
      when: string;
      plies: string;
    };
    outcome: { win: string; loss: string; draw: string };
    reason: Record<EndReason, string>;
    /** Counter suffixes: rendered as `${n}` + the string, so "3분 전". */
    ago: { now: string; minute: string; hour: string; day: string };
  };
  /** Counter suffixes shared by the leaderboard and the profile tiles. */
  stat: { win: string; loss: string; draw: string; move: string };
  pvp: {
    lobby: {
      title: string;
      subtitle: string;
      homeLink: string;
      signedInAs: string;
      guestLabel: string;
      guestPlaceholder: string;
      guestHint: string;
      guestFallbackName: string;
      quick: {
        title: string;
        help: string;
        start: string;
        searching: string;
        positionLabel: string;
        cancel: string;
      };
      create: { title: string; help: string; action: string; failed: string };
      join: {
        title: string;
        help: string;
        label: string;
        placeholder: string;
        action: string;
        invalid: string;
      };
    };
    room: {
      codeLabel: string;
      copy: string;
      copied: string;
      playersLabel: string;
      you: string;
      emptySeat: string;
      waitingOpponent: string;
      connected: string;
      disconnected: string;
      spectatorsLabel: string;
      spectatingBadge: string;
      clocksLabel: string;
      turnYours: string;
      turnTheirs: string;
      turnOf: Record<Seat, string>;
      resign: string;
      resignConfirm: string;
      resignCancel: string;
      rematch: string;
      rematchSent: string;
      rematchIncoming: string;
      leave: string;
      notFound: string;
      notFoundBack: string;
      seat: Record<Seat, string>;
      over: {
        title: string;
        youWin: string;
        youLose: string;
        draw: string;
        winnerIs: Record<Seat, string>;
        reason: Record<EndReason, string>;
      };
    };
    connection: { connecting: string; reconnecting: string; closed: string; retry: string };
    error: Record<ServerErrorCode, string> & { network: string };
    a11y: { panel: string; lobby: string };
  };
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
      freestyle: "금수 없이 돌 5개 이상을 먼저 이으면 이깁니다.",
      double_three_ban: "한 번에 3이 두 개 생기는 자리는 흑백 모두 둘 수 없습니다.",
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
  landing: {
    tagline: "3D 바둑판에서 말을 건네는 AI와 가볍게 두거나, 실시간으로 다른 사람과 맞붙어 보세요.",
    nav: { play: "AI 대국", pvp: "실시간 대국", profile: "내 전적" },
    entries: {
      ai: {
        label: "AI 대국",
        desc: "수를 둘 때마다 말을 건네는 AI와 기다림 없이 바로 한판.",
      },
      pvp: {
        label: "실시간 대국",
        desc: "대기 중인 사람과 바로 맞붙거나 6자리 방 코드로 친구를 초대할 수 있습니다.",
      },
      profile: {
        label: "내 전적",
        desc: "로그인하면 승패와 최근 대국 기록이 차곡차곡 남습니다.",
      },
    },
    leaderboard: { title: "순위표", caption: "최다 승리를 기록한 상위 5명입니다." },
  },
  auth: {
    signIn: "로그인",
    signOut: "로그아웃",
    guest: "게스트",
    callback: {
      waiting: "로그인 처리 중입니다. 잠시만 기다려 주세요.",
      errorTitle: "로그인을 완료하지 못했습니다",
      errorBody:
        "로그인이 제대로 되지 않았습니다. 다시 시도해 보시고, 문제가 계속되면 잠시 후 다시 시도해 주세요.",
      retry: "다시 로그인",
    },
  },
  profile: {
    title: "내 전적",
    guest: {
      title: "로그인하고 전적을 남겨보세요",
      body: "게스트 상태에서도 AI 대국과 실시간 대국을 모두 즐길 수 있습니다. 다만 승패 기록은 로그인해야 저장됩니다.",
      cta: "로그인하기",
    },
    stats: {
      wins: "승리",
      losses: "패배",
      draws: "무승부",
      played: "총 대국",
      streak: "현재 연승",
      bestStreak: "최다 연승",
    },
    recent: {
      title: "최근 대국",
      empty: "아직 끝난 대국이 없습니다. 한 판 두고 나면 여기에 기록됩니다.",
      opponent: "상대",
      seat: "흑/백",
      result: "결과",
      reason: "종료 사유",
      when: "일시",
      plies: "총 수",
    },
    outcome: { win: "승", loss: "패", draw: "무" },
    reason: {
      five: "5목",
      resign: "기권",
      timeout: "시간 초과",
      abandoned: "접속 종료",
      draw: "무승부",
    },
    ago: { now: "방금 전", minute: "분 전", hour: "시간 전", day: "일 전" },
  },
  stat: { win: "승", loss: "패", draw: "무", move: "수" },
  pvp: {
    lobby: {
      title: "온라인 대국",
      subtitle: "흑이 먼저 두고, 한 수에 1분씩.",
      homeLink: "처음으로",
      signedInAs: "접속 계정",
      guestLabel: "닉네임",
      guestPlaceholder: "오목꿈나무",
      guestHint: "로그인 없이 바로 둘 수 있지만 전적은 남지 않습니다.",
      guestFallbackName: "손님",
      quick: {
        title: "빠른 매칭",
        help: "지금 기다리는 사람과 바로 한 판.",
        start: "상대 찾기",
        searching: "상대 찾는 중…",
        positionLabel: "대기 순번",
        cancel: "매칭 취소",
      },
      create: {
        title: "비공개 방",
        help: "방을 만들고 6자리 코드를 친구에게 보내세요.",
        action: "방 만들기",
        failed: "방을 만들지 못했습니다. 다시 시도해 주세요.",
      },
      join: {
        title: "코드로 입장",
        help: "친구에게 받은 6자리 코드를 넣고 들어갑니다.",
        label: "참여 코드",
        placeholder: "AB12CD",
        action: "입장하기",
        invalid: "코드는 6자리여야 합니다.",
      },
    },
    room: {
      codeLabel: "방 코드",
      copy: "코드 복사",
      copied: "복사되었습니다.",
      playersLabel: "대국자",
      you: "나",
      emptySeat: "빈자리",
      waitingOpponent: "상대를 기다리는 중입니다.",
      connected: "접속 중",
      disconnected: "접속 끊김",
      spectatorsLabel: "관전자",
      spectatingBadge: "관전 중",
      clocksLabel: "남은 시간",
      turnYours: "내 차례입니다.",
      turnTheirs: "상대 차례입니다.",
      turnOf: { black: "흑돌 차례입니다.", white: "백돌 차례입니다." },
      resign: "기권",
      resignConfirm: "기권하기",
      resignCancel: "계속 두기",
      rematch: "재대국 신청",
      rematchSent: "재대국을 신청했습니다. 상대의 응답을 기다리는 중입니다.",
      rematchIncoming: "상대가 재대국을 요청했습니다. 버튼을 눌러 수락하세요.",
      leave: "나가기",
      notFound: "존재하지 않거나 이미 종료된 방입니다.",
      notFoundBack: "로비로 이동",
      seat: { black: "흑돌", white: "백돌" },
      over: {
        title: "대국 결과",
        youWin: "승리하셨습니다!",
        youLose: "패배했습니다.",
        draw: "무승부입니다.",
        winnerIs: { black: "흑돌이 승리했습니다.", white: "백돌이 승리했습니다." },
        reason: {
          five: "오목 완성",
          resign: "기권",
          timeout: "시간 초과",
          abandoned: "대국 이탈",
          draw: "판 가득 참",
        },
      },
    },
    connection: {
      connecting: "방에 연결하는 중입니다…",
      reconnecting: "연결이 끊어져 다시 연결하는 중입니다…",
      closed: "연결이 끊어졌습니다. 페이지를 새로고침하거나 다시 시도해 주세요.",
      retry: "다시 연결",
    },
    error: {
      bad_message: "잘못된 요청입니다.",
      unauthenticated: "다시 로그인해 주세요.",
      room_full: "빈자리가 없어 관전만 가능합니다.",
      not_your_turn: "차례를 기다려 주세요.",
      illegal_move: "둘 수 없는 자리입니다.",
      forbidden_point: "33 금수 규칙에 따라 둘 수 없는 자리입니다.",
      game_over: "이미 종료된 대국입니다.",
      stale_ply: "대국 상황이 바뀌어 판을 새로고침했습니다.",
      version_mismatch: "최신 버전이 아닙니다. 페이지를 새로고침해 주세요.",
      rate_limited: "요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.",
      network: "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.",
    },
    a11y: { panel: "대국 정보 및 조작 패널", lobby: "온라인 대국 로비" },
  },
};
