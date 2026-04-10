import { useEffect, useState } from 'react'
import {
  type StudyAbcAILimits,
  currentLimits,
  statusListeners,
} from './studyAbcAiLimits.js'

export function useStudyAbcAiLimits(): StudyAbcAILimits {
  const [limits, setLimits] = useState<StudyAbcAILimits>({ ...currentLimits })

  useEffect(() => {
    const listener = (newLimits: StudyAbcAILimits) => {
      setLimits({ ...newLimits })
    }
    statusListeners.add(listener)

    return () => {
      statusListeners.delete(listener)
    }
  }, [])

  return limits
}
