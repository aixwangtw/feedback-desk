<?php

namespace App\Http\Controllers\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Http\Controllers\Controller;
use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * 專案設定：開發者調整這個專案的開單分類。
 */
class FeedbackProjectSettingsController extends Controller
{
    public const MAX_INPUT_LENGTH = 1000;

    public const MAX_CATEGORIES = 20;

    public const MAX_CATEGORY_LENGTH = 50;

    public const MAX_STATUS_LABEL_LENGTH = 20;

    public function updateCategories(Request $request, FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        if (! $access->isOwner($feedbackProject)) {
            $access->deny($feedbackProject);
        }

        $validated = $request->validateWithBag('categories', [
            'categories' => ['nullable', 'string', 'max:'.self::MAX_INPUT_LENGTH],
        ], attributes: ['categories' => '開單分類']);

        $back = redirect()->to(route('feedback.account', $feedbackProject).'#project-settings');
        $categories = self::parse((string) ($validated['categories'] ?? ''));
        $problem = self::problem($categories);
        if ($problem !== null) {
            return $back->withInput()->withErrors(['categories' => $problem], 'categories');
        }

        $feedbackProject->update(['report_categories' => $categories === [] ? null : $categories]);

        return $back->with('success', $categories === []
            ? '已清除開單分類，這個專案不再顯示分類欄位。'
            : '已更新開單分類：'.implode('、', $categories).'。');
    }

    /**
     * 自訂這個看板的狀態名稱；欄位留空的狀態沿用全站名稱，三格都留空就整個清除。
     */
    public function updateStatusLabels(Request $request, FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        if (! $access->isOwner($feedbackProject)) {
            $access->deny($feedbackProject);
        }

        $rules = [];
        $attributes = [];
        foreach (FeedbackReportStatus::cases() as $status) {
            $rules["status_labels.{$status->value}"] = ['nullable', 'string', 'max:'.self::MAX_STATUS_LABEL_LENGTH];
            $attributes["status_labels.{$status->value}"] = '「'.$status->label().'」的名稱';
        }
        $validated = $request->validateWithBag('statusLabels', $rules, attributes: $attributes);

        $labels = [];
        foreach (FeedbackReportStatus::cases() as $status) {
            $label = trim((string) ($validated['status_labels'][$status->value] ?? ''));
            if ($label !== '') {
                $labels[$status->value] = $label;
            }
        }

        $feedbackProject->update(['status_labels' => $labels === [] ? null : $labels]);

        return redirect()->to(route('feedback.account', $feedbackProject).'#project-settings')->with('success', $labels === []
            ? '已清除自訂狀態名稱，這個看板沿用全站名稱。'
            : '已更新狀態名稱：'.implode('、', array_map(fn (FeedbackReportStatus $status): string => $status->label($feedbackProject), FeedbackReportStatus::cases())).'。');
    }

    /**
     * 逗號（全形、半形）或換行分隔。
     *
     * @return list<string>
     */
    public static function parse(string $input): array
    {
        return FeedbackProject::normalizeCategories(preg_split('/[,，\r\n]+/u', $input) ?: []);
    }

    /**
     * @param  list<string>  $categories
     */
    public static function problem(array $categories): ?string
    {
        if (count($categories) > self::MAX_CATEGORIES) {
            return '分類最多 '.self::MAX_CATEGORIES.' 個。';
        }
        foreach ($categories as $category) {
            if (mb_strlen($category) > self::MAX_CATEGORY_LENGTH) {
                return "分類「{$category}」太長，每個最多 ".self::MAX_CATEGORY_LENGTH.' 字。';
            }
        }

        return null;
    }
}
