"use client";

import { useEffect, useRef } from "react";

import { toNotation } from "@/engine/rules";
import { UI } from "@/lib/lines";
import { useGameStore } from "@/store/game";

export function MoveRecord() {
  const moves = useGameStore((state) => state.moves);
  const listRef = useRef<HTMLOListElement>(null);

  // The list is short and scrollable, so keep the newest move in view.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [moves.length]);

  return (
    <section className="record" aria-labelledby="record-heading">
      <h2 className="panel__heading" id="record-heading">
        {UI.record.label}
      </h2>
      {moves.length === 0 ? (
        <p className="record__empty">{UI.record.empty}</p>
      ) : (
        <ol className="record__list" ref={listRef}>
          {moves.map((move, index) => (
            <li
              className="record__item"
              data-stone={index % 2 === 0 ? "black" : "white"}
              key={`${String(index)}-${toNotation(move)}`}
            >
              <span className="record__no">{index + 1}</span>
              <span className="record__stone" aria-hidden="true" />
              <span className="record__who">
                {index % 2 === 0 ? UI.record.black : UI.record.white}
              </span>
              <span className="record__at">{toNotation(move)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
