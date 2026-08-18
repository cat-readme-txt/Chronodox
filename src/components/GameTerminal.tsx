import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore, useTerminalSuggestions } from '../store/gameStore';
import { GUIDED_TUTORIAL_STEPS } from '../tutorial/guidedTutorial';

function getSharedPrefix(values: string[]) {
  if (values.length === 0) return '';
  let prefix = values[0];

  for (let i = 1; i < values.length; i += 1) {
    while (prefix && !values[i].toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1);
    }
    if (!prefix) break;
  }

  return prefix;
}

export function GameTerminal() {
  const {
    terminalHistory, submitTerminalInput, suMode, terminalAwaitingPassword,
    awaitingNextRound, autoNextDeadline, localPlayer, appendTerminalMessage,
    tutorialOpen, tutorialSectionIndex,
  } = useGameStore();
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now());

  const suggestions = useTerminalSuggestions(input);
  const enteredCommands = useMemo(
    () => terminalHistory
      .filter(entry => entry.kind === 'input')
      .map(entry => entry.text.replace(/^(?:password:|[^ ]+@chronodox(?:-[^:]+)?:~[#\$])\s+/, ''))
      .filter(command => command !== '********'),
    [terminalHistory],
  );
  const prompt = terminalAwaitingPassword
    ? 'password:'
    : suMode
      ? `root@chronodox-${localPlayer.toLowerCase()}:~#`
      : `${localPlayer.toLowerCase()}@chronodox:~$`;
  const displayHint = !terminalAwaitingPassword && !input.trim() ? 'type help' : '';
  const normalizedInput = input.trim().toLowerCase();
  const matchingSuggestions = useMemo(
    () => suggestions.filter(suggestion => normalizedInput && suggestion.value.toLowerCase().startsWith(normalizedInput)),
    [normalizedInput, suggestions],
  );
  const sharedCompletion = useMemo(
    () => getSharedPrefix(matchingSuggestions.map(suggestion => suggestion.value)),
    [matchingSuggestions],
  );
  const isAmbiguousCompletion = matchingSuggestions.length > 1
    && !matchingSuggestions.some(suggestion => suggestion.value.toLowerCase() === normalizedInput);
  const bestSuggestion = useMemo(() => {
    if (terminalAwaitingPassword) return '';
    if (!input.trim()) return suggestions[0]?.value ?? 'help';
    if (matchingSuggestions.length === 1) return matchingSuggestions[0].value;
    if (sharedCompletion && sharedCompletion.length > input.length) return sharedCompletion;
    return '';
  }, [input, matchingSuggestions, sharedCompletion, suggestions, terminalAwaitingPassword]);
  const ghostSuffix = useMemo(() => {
    if (!bestSuggestion) return '';
    if (!input) return bestSuggestion;
    if (bestSuggestion.toLowerCase().startsWith(input.toLowerCase())) {
      return bestSuggestion.slice(input.length);
    }
    return '';
  }, [bestSuggestion, input]);
  const tutorialStep = GUIDED_TUTORIAL_STEPS[tutorialSectionIndex] ?? null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [terminalHistory]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!tutorialOpen || tutorialStep?.targetId !== 'terminal-shell') return;
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(timeoutId);
  }, [tutorialOpen, tutorialStep]);

  useEffect(() => {
    if (!awaitingNextRound || !autoNextDeadline) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [awaitingNextRound, autoNextDeadline]);

  const countdown = useMemo(() => {
    if (!awaitingNextRound || !autoNextDeadline) return null;
    return Math.max(0, ((autoNextDeadline - now) / 1000)).toFixed(1);
  }, [awaitingNextRound, autoNextDeadline, now]);

  return (
    <div id="terminal-shell" className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#00ffcc33] bg-[#02070df2] shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between border-b border-[#ffffff12] px-4 py-2">
        <div className="font-['Orbitron'] text-[11px] tracking-[0.28em] text-[#8df5df]">TACTICAL TERMINAL</div>
        <div className="font-['Share_Tech_Mono'] text-[10px] text-[#ffffff55]">
          {awaitingNextRound && countdown ? `AUTO NEXT IN ${countdown}s` : 'LIVE SHELL'}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,255,170,0.05),transparent_22%,transparent_78%,rgba(0,255,170,0.03))] opacity-70" />
        <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent_0_22px,rgba(255,255,255,0.025)_22px_23px)] opacity-30" />

        <div className="relative flex h-full flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-3 font-['Share_Tech_Mono'] text-[12px] leading-6 text-[#d9ffe9]">
            {terminalHistory.map(entry => (
              <div key={entry.id} className="whitespace-pre-wrap break-words">
                <span className="mr-2 text-[#ffffff33]">R{entry.round}</span>
                <span
                  style={{
                    color:
                      entry.kind === 'error'
                        ? '#ff8c8c'
                        : entry.kind === 'system'
                          ? '#ffd39f'
                          : entry.kind === 'input'
                            ? '#9cc6ff'
                            : '#d9ffe9',
                  }}
                >
                  {entry.text}
                </span>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="relative border-t border-[#ffffff12] px-4 py-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!input.trim()) return;
                submitTerminalInput(input);
                setInput('');
                setHistoryIndex(null);
              }}
              className="flex items-center gap-3 font-['Share_Tech_Mono'] text-[12px] leading-6"
            >
              <div className="shrink-0 whitespace-pre text-[#8df5df]">{prompt}</div>
              <div className="relative flex-1">
                {!terminalAwaitingPassword && (
                  <div className="pointer-events-none absolute inset-0 flex items-center text-[12px] leading-6">
                    {input ? <span className="invisible whitespace-pre">{input}</span> : null}
                    <span className="whitespace-pre text-[#ffffff33]">{input ? ghostSuffix : displayHint}</span>
                  </div>
                )}
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    setHistoryIndex(null);
                  }}
                  onClick={() => setHistoryIndex(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      if (enteredCommands.length === 0) return;
                      const nextIndex = historyIndex === null
                        ? enteredCommands.length - 1
                        : Math.max(0, historyIndex - 1);
                      setHistoryIndex(nextIndex);
                      setInput(enteredCommands[nextIndex]);
                      return;
                    }

                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      if (enteredCommands.length === 0) return;
                      if (historyIndex === null) return;
                      const nextIndex = historyIndex + 1;
                      if (nextIndex >= enteredCommands.length) {
                        setHistoryIndex(null);
                        setInput('');
                        return;
                      }
                      setHistoryIndex(nextIndex);
                      setInput(enteredCommands[nextIndex]);
                      return;
                    }

                    if (event.key === 'Tab' && bestSuggestion) {
                      event.preventDefault();
                      setInput(bestSuggestion);
                      setHistoryIndex(null);
                      return;
                    }

                    if (event.key === 'Tab' && isAmbiguousCompletion) {
                      event.preventDefault();
                      appendTerminalMessage(
                        `Ambiguous completion for "${input.trim()}": ${matchingSuggestions.map(item => item.value).join(' or ')}`,
                        'system',
                      );
                      return;
                    }

                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
                      event.preventDefault();
                      const target = event.currentTarget;
                      window.requestAnimationFrame(() => {
                        target.setSelectionRange(0, 0);
                      });
                      return;
                    }

                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
                      event.preventDefault();
                      const target = event.currentTarget;
                      const end = target.value.length;
                      window.requestAnimationFrame(() => {
                        target.setSelectionRange(end, end);
                      });
                      return;
                    }

                    if (event.ctrlKey && event.key.toLowerCase() === 'u') {
                      event.preventDefault();
                      const target = event.currentTarget;
                      const cursor = target.selectionStart ?? 0;
                      const nextValue = target.value.slice(cursor);
                      setInput(nextValue);
                      setHistoryIndex(null);
                      window.requestAnimationFrame(() => {
                        target.setSelectionRange(0, 0);
                      });
                      return;
                    }

                    if (event.ctrlKey && event.key.toLowerCase() === 'k') {
                      event.preventDefault();
                      const target = event.currentTarget;
                      const cursor = target.selectionStart ?? target.value.length;
                      const nextValue = target.value.slice(0, cursor);
                      setInput(nextValue);
                      setHistoryIndex(null);
                      window.requestAnimationFrame(() => {
                        target.setSelectionRange(cursor, cursor);
                      });
                    }
                  }}
                  type={terminalAwaitingPassword ? 'password' : 'text'}
                  className="relative z-10 flex-1 w-full border-none bg-transparent text-[12px] leading-6 text-white outline-none"
                  placeholder={terminalAwaitingPassword ? 'enter password' : ''}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
