import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api.ts';

type Section = 'traits' | 'skills' | 'spells' | 'items' | 'enchantments';

/** Online-only library write plumbing; each section keeps its own explicit form. */
export function useLibrarySectionCrud<Create, Out>(campaignId: string | null, section: Section) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const base = `/campaigns/${campaignId}/library/${section}`;
  const refresh = () => qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });

  const create = useMutation({
    mutationFn: (body: Create) => api<Out>(base, { method: 'POST', body }),
    onSuccess: () => {
      setAddOpen(false);
      void refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Create }) =>
      api<Out>(`${base}/${id}`, { method: 'PATCH', body }),
    onSuccess: (_result, { id }) => {
      setEditId((current) => (current === id ? null : current));
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: (_result, id) => {
      setDeleteId((current) => (current === id ? null : current));
      void refresh();
    },
  });

  return { addOpen, setAddOpen, editId, setEditId, deleteId, setDeleteId, create, update, remove };
}
