-- Extend persistent experiments to retain the complete BusinessFlow experiment record.
alter table public.businessflow_experiments
  add column if not exists baseline_value numeric,
  add column if not exists result_value numeric,
  add column if not exists learning_notes text;

alter table public.businessflow_experiments
  drop constraint if exists businessflow_experiments_baseline_value_check,
  add constraint businessflow_experiments_baseline_value_check
    check (baseline_value is null or baseline_value >= 0),
  drop constraint if exists businessflow_experiments_result_value_check,
  add constraint businessflow_experiments_result_value_check
    check (result_value is null or result_value >= 0),
  drop constraint if exists businessflow_experiments_learning_notes_check,
  add constraint businessflow_experiments_learning_notes_check
    check (learning_notes is null or char_length(learning_notes) <= 2000);

alter table public.businessflow_experiments
  drop constraint if exists businessflow_experiments_status_check,
  add constraint businessflow_experiments_status_check
    check (status = any (array['draft','planned','running','review','completed','cancelled']::text[]));
