import { createContext, useMemo, type ReactNode } from 'react'
import { defineAbilityFor, type AppAbility } from '@music-together/shared'
import { useRoomStore } from '@/stores/roomStore'

const defaultAbility = defineAbilityFor('member')

/**
 * CASL ability context. Consumers read the ability via `useContext(AbilityContext)`
 * and call `ability.can(action, subject)` directly.
 *
 * Note: @casl/react v7 removed `createContextualCan`. The previous `<Can>` render
 * prop helper was never consumed in this codebase, so we drop it and keep the
 * plain context (all call sites already use `useContext(AbilityContext)`).
 */
export const AbilityContext = createContext<AppAbility>(defaultAbility)

export function AbilityProvider({ children }: { children: ReactNode }) {
  const role = useRoomStore((s) => s.currentUser?.role ?? 'member')
  const ability = useMemo(() => defineAbilityFor(role), [role])

  return <AbilityContext.Provider value={ability}>{children}</AbilityContext.Provider>
}
