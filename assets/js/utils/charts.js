/*
 * Graphiques ApexCharts, avec les réglages visuels du modèle Spark Admin (couleurs `#072F1F` et `#B4F105`).
 * ApexCharts est une lib classique chargée par la page : la page doit inclure
 * assets/libs/apexcharts/apexcharts.min.js (et .css) avant son module.
 */

import { formatNumber } from './format.js';

export const CHART_COLORS = {
    forest: '#072F1F',
    forestDark: '#051C12',
    lime: '#B4F105',
    orange: '#F97316',
    green: '#22C55E',
    red: '#EF4444',
    muted: '#9FB3A9',
};

const FONT = 'Plus Jakarta Sans, sans-serif';
const pick = (target) => (typeof target === 'string' ? document.querySelector(target) : target);

function render(target, options) {
    const el = pick(target);
    if (!el) return null;
    if (typeof ApexCharts === 'undefined') {
        console.error("ApexCharts n'est pas chargé sur cette page.");
        return null;
    }
    const chart = new ApexCharts(el, options);
    chart.render();
    return chart;
}

/** Mini courbe de carte KPI. tone : 'good' (vert) ou 'bad' (rouge). */
export function sparkline(target, { name, data, tone = 'good', format = (v) => formatNumber(v, 1) }) {
    return render(target, {
        series: [{ name, data }],
        chart: { type: 'area', height: 45, sparkline: { enabled: true }, fontFamily: FONT },
        stroke: { curve: 'smooth', width: 2 },
        fill: { opacity: 0.1, type: 'solid' },
        colors: [tone === 'bad' ? CHART_COLORS.red : CHART_COLORS.green],
        tooltip: {
            fixed: { enabled: false },
            x: { show: false },
            y: { title: { formatter: () => '' }, formatter: format },
            marker: { show: false },
        },
    });
}

/** Barres verticales groupées (comme le graphique « Revenue » du template). */
export function groupedBars(target, { categories, series, colors, max, format = (v) => formatNumber(v, 2), height = 260 }) {
    return render(target, {
        series,
        chart: { type: 'bar', height, stacked: false, toolbar: { show: false }, zoom: { enabled: false }, fontFamily: FONT },
        colors,
        states: { hover: { filter: { type: 'none' } } },
        plotOptions: { bar: { horizontal: false, columnWidth: '48%', borderRadius: 0 } },
        dataLabels: { enabled: false },
        stroke: { show: true, width: 2, colors: ['transparent'] },
        legend: { show: false }, // légende HTML sous le titre, comme dans le template
        grid: {
            borderColor: '#E9EFEF',
            strokeDashArray: 4,
            yaxis: { lines: { show: true } },
            xaxis: { lines: { show: false } },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        xaxis: {
            categories,
            labels: { style: { colors: '#6C7E75', fontSize: '11px', fontWeight: 500 } },
            axisBorder: { show: false },
            axisTicks: { show: false },
        },
        yaxis: {
            min: 0,
            max,
            tickAmount: 4,
            labels: { style: { colors: '#6C7E75', fontSize: '11px', fontWeight: 500 }, formatter: (v) => formatNumber(v, 0) },
        },
        fill: { opacity: 1 },
        tooltip: { y: { formatter: (v) => (v === null || v === undefined ? 'Pas encore de note validée' : format(v)) }, theme: 'dark' },
        noData: { text: 'Aucune donnée', style: { color: '#6C7E75', fontFamily: FONT } },
    });
}

/** Anneau (comme « Total View Performance »). Le centre affiche le total ; au survol, la valeur du segment. */
export function donut(target, { labels, series, colors, totalLabel, height = 250 }) {
    const total = series.reduce((sum, v) => sum + v, 0);
    return render(target, {
        series,
        chart: { type: 'donut', height, fontFamily: FONT },
        labels,
        colors,
        states: { hover: { filter: { type: 'none' } } },
        legend: { show: false }, // légende HTML sous le graphique
        dataLabels: { enabled: false },
        stroke: { width: 2, colors: ['#FFFFFF'] },
        plotOptions: {
            pie: {
                donut: {
                    size: '72%',
                    background: 'transparent',
                    labels: {
                        show: true,
                        name: { show: true, fontSize: '12px', fontWeight: 500, color: '#6C7E75', offsetY: -8 },
                        value: { show: true, fontSize: '26px', fontWeight: 800, color: '#0B130F', offsetY: 8, formatter: (v) => formatNumber(Number(v)) },
                        total: { show: true, label: totalLabel, fontSize: '11px', fontWeight: 500, color: '#6C7E75', formatter: () => formatNumber(total) },
                    },
                },
            },
        },
        tooltip: { theme: 'dark' },
    });
}

/**
 * Dessine la courbe d'une carte créée avec trendCard (conteneur #spark-<id>).
 * card : { id, label, series, format, trend: { good } }. Retourne le graphique (à détruire avant un nouveau rendu).
 */
export function cardSparkline(card) {
    return sparkline(`#spark-${card.id}`, { name: card.label, data: card.series, format: card.format, tone: card.trend.good ? 'good' : 'bad' });
}
