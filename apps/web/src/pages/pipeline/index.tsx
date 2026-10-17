import {
  APPLICATION_STAGES,
  type ApplicationStage,
  NO_REPLY_FLAG_DAYS,
  type PipelineItem,
} from "@jobfilly/schema";
import { Link } from "react-router";
import { errorText } from "../../api";
import { Alert, Badge, Card, Loading, PageHeader, SelectField } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import { usePipeline, useSetStage } from "./queries";

// The application pipeline (MVP 3, F5): every role grouped by stage, how long it has been there,
// the next step, the flag for no reply in 21 days, and the same role from several senders once
// with all of them. An editor moves a role by hand; that stage wins over the mail until put back
// to "As the mail says". Viewers read. A member who sees the pipeline only sees all of it.

const LABEL: Record<ApplicationStage, string> = {
  new: "New",
  replied: "Replied",
  applied: "Applied",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  rejected: "Rejected",
  closed: "Closed",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function timeInStage(since: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / DAY_MS));
  if (days === 0) return "Since today";
  return days === 1 ? "For 1 day" : `For ${days} days`;
}

/** What the select shows for "back to the stage the mail gives". */
const DERIVED = "derived";

function ItemCard({ item }: { item: PipelineItem }) {
  const { workspaceId, can } = useWorkspace();
  const setStage = useSetStage(workspaceId);
  const name = [item.title ?? "Untitled role", item.company].filter(Boolean).join(" · ");
  return (
    <Card>
      <article aria-label={name} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="text-sm font-semibold text-indigo-700 hover:underline"
            to={paths.message(workspaceId, item.role.messageId)}
          >
            {name}
          </Link>
          {item.noReply && (
            <Badge tone="warning" label={`No reply for ${NO_REPLY_FLAG_DAYS} days or more`}>
              No reply
            </Badge>
          )}
          {item.stageSource === "you" && <Badge>Set by you</Badge>}
        </div>
        <p className="text-xs text-stone-600">
          {item.senders.length > 1 ? `From ${item.senders.length} senders: ` : "From "}
          {item.senders.map((s) => s.name ?? s.address).join(", ")}
        </p>
        <p className="text-sm text-stone-700">
          {timeInStage(item.since)} · Next: {item.nextStep}
        </p>
        {can.edit && (
          <SelectField
            label="Stage"
            className="max-w-56"
            value={item.stageSource === "you" ? item.stage : DERIVED}
            disabled={setStage.isPending}
            onChange={(e) => {
              const value = e.target.value;
              setStage.mutate({
                role: item.role,
                stage: value === DERIVED ? null : (value as ApplicationStage),
              });
            }}
          >
            <option value={DERIVED}>
              As the mail says{item.stageSource === "derived" ? ` (${LABEL[item.stage]})` : ""}
            </option>
            {APPLICATION_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {LABEL[stage]}
              </option>
            ))}
          </SelectField>
        )}
        {setStage.error && <Alert>{errorText(setStage.error)}</Alert>}
      </article>
    </Card>
  );
}

interface PipelinePageProps {
  workspaceId: string;
}

export function PipelinePage({ workspaceId }: PipelinePageProps) {
  const pipeline = usePipeline(workspaceId);
  const total = pipeline.data?.stages.reduce((n, s) => n + s.items.length, 0) ?? 0;
  return (
    <div>
      <PageHeader
        title="Pipeline"
        description={`Every role by stage, from its mail. Roles with no reply for ${NO_REPLY_FLAG_DAYS} days are flagged.`}
      />
      {pipeline.isLoading && <Loading />}
      {pipeline.error && <Alert>{errorText(pipeline.error)}</Alert>}
      {pipeline.data && total === 0 && (
        <Card>
          <p className="text-sm text-stone-600">
            No roles yet. Each role from your job mail shows here with its stage.
          </p>
        </Card>
      )}
      {pipeline.data && total > 0 && (
        <div className="flex flex-col gap-6">
          {pipeline.data.stages.map(({ stage, items }) => (
            <section key={stage} aria-label={LABEL[stage]}>
              <h2 className="mb-2 text-base font-semibold text-stone-900">
                {LABEL[stage]} <span className="text-stone-500">({items.length})</span>
              </h2>
              {items.length === 0 ? (
                <p className="text-sm text-stone-500">None</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {items.map((item) => (
                    <li key={`${item.role.messageId}#${item.role.position}`}>
                      <ItemCard item={item} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
