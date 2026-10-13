// Link preview image for each weekly report: /og/{season}/week-{n}.png, plus /og/site.png for every other page.
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { renderCard } from '../../lib/og';

export const getStaticPaths = (async () => {
  const reports = await getCollection('reports');
  return [
    ...reports.map(({ id, data }) => ({
      params: { slug: id },
      props: {
        kicker: `Week ${data.week} · ${data.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
        headline: data.headline,
      },
    })),
    { params: { slug: 'site' }, props: { kicker: 'Weekly reports · Standings · Power rankings', headline: 'Everything happening in the Illini league, every week.' } },
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
  new Response(new Uint8Array(renderCard(props as { kicker: string; headline: string })), {
    headers: { 'Content-Type': 'image/png' },
  });
