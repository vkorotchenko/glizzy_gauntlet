import { useCallback, useEffect, useRef, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'

export const MAX_MEAL_PHOTOS = 3

export function useMealPhotos(
  selected: string[],
  change: (ids: string[]) => void,
) {
  const cache = useQueryClient()
  const input = useRef<HTMLInputElement | null>(null)
  const connectInput = useCallback((element: HTMLInputElement | null) => {
    input.current = element
  }, [])
  const active = useRef(false)
  const selection = useRef(selected)
  useEffect(() => {
    selection.current = selected
  }, [selected])
  const staged = useQuery({
    queryKey: ['meals', 'staged-photos'],
    queryFn: ({ signal }) => api.stagedPhotos(signal),
  })
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      if (files.length + selection.current.length > MAX_MEAL_PHOTOS)
        throw new Error('Choose at most 3 photos per meal.')
      if (
        files.some((file) => !['image/jpeg', 'image/png'].includes(file.type))
      )
        throw new Error('Choose JPEG or PNG photos.')
      if (files.some((file) => file.size > 5 * 1024 * 1024))
        throw new Error('Choose photos no larger than 5 MiB each.')
      for (const file of files) {
        const photo = await api.uploadPhoto(file)
        selection.current = [...selection.current, photo.id]
        change(selection.current)
      }
    },
    onSettled: async () => {
      try {
        await cache.invalidateQueries({ queryKey: ['meals', 'staged-photos'] })
      } finally {
        active.current = false
      }
    },
  })
  const discard = useMutation({
    mutationFn: (id: string) => api.discardPhoto(id),
    onSuccess: async (_, id) => {
      change(selection.current.filter((photo) => photo !== id))
      await cache.invalidateQueries({ queryKey: ['meals', 'staged-photos'] })
    },
  })
  const uploadFiles = (files: File[]) => {
    if (!files.length || active.current || discard.isPending) return
    active.current = true
    upload.mutate(files)
  }
  return {
    connectInput,
    staged,
    upload,
    discard,
    uploadFiles,
    choose: () => input.current?.click(),
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      uploadFiles(Array.from(event.target.files ?? []))
      event.target.value = ''
    },
  }
}
