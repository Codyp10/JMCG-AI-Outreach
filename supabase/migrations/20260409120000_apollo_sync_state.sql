-- Tracks Apollo People Search pagination (singleton row id = 1).

CREATE TABLE public.apollo_sync_state (
  id smallint PRIMARY KEY DEFAULT 1,
  CONSTRAINT apollo_sync_state_singleton CHECK (id = 1),
  people_search_page integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.apollo_sync_state IS 'Singleton id=1. people_search_page is passed to Apollo mixed_people/api_search; worker advances or resets when results are exhausted.';

INSERT INTO public.apollo_sync_state (id, people_search_page) VALUES (1, 1);

ALTER TABLE public.apollo_sync_state ENABLE ROW LEVEL SECURITY;
