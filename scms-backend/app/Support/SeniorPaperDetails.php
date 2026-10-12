<?php

namespace App\Support;

use App\Models\SeniorCitizen;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Picks the senior's personal details out of the text OCR read off their
 * registration papers (see App\Support\DocumentOcr).
 *
 * Two rules keep wrong details out of a record:
 *
 *  1. A photo is only read as a birth certificate or a barangay certificate
 *     when the text actually looks like one. Seniors do photograph the wrong
 *     paper, and a utility bill must not become someone's date of birth.
 *  2. Every value is checked before it is returned - a real calendar date for
 *     someone 60 or older, a sex of Male or Female, a purok that exists.
 *     Anything else is dropped and left for staff to fill in.
 */
class SeniorPaperDetails
{
    /** The OSCA office registers seniors from 60 years old. */
    public const MINIMUM_AGE = 60;

    /** Printed on every PSA birth certificate. */
    private const BIRTH_CERTIFICATE_MARKS = [
        'certificate of live birth',
        'philippine statistics authority',
    ];

    /** A barangay certificate names the barangay and calls itself one. */
    private const BARANGAY_CERTIFICATE_MARKS = ['barangay', 'certificate'];

    private const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    private const SPELLED_NUMBERS = [
        'one' => 1, 'two' => 2, 'three' => 3, 'four' => 4, 'five' => 5, 'six' => 6, 'seven' => 7,
        'i' => 1, 'ii' => 2, 'iii' => 3, 'iv' => 4, 'v' => 5, 'vi' => 6, 'vii' => 7,
    ];

    /**
     * The details worth keeping, as senior_citizens columns. A value is null
     * when the paper did not say it, did not look like the right paper, or
     * said something that failed its check.
     *
     * @return array{middle_name: ?string, birth_date: ?string, gender: ?string, purok: ?string}
     */
    public static function read(string $birthCertificateText, string $barangayCertificateText): array
    {
        $birth = self::looksLike($birthCertificateText, self::BIRTH_CERTIFICATE_MARKS, any: true)
            ? self::tidy($birthCertificateText)
            : '';

        $barangay = self::looksLike($barangayCertificateText, self::BARANGAY_CERTIFICATE_MARKS, any: false)
            ? self::tidy($barangayCertificateText)
            : '';

        return [
            'middle_name' => $birth === '' ? null : self::middleName($birth),
            'birth_date' => $birth === '' ? null : self::birthDate($birth),
            'gender' => $birth === '' ? null : self::sex($birth),
            'purok' => $barangay === '' ? null : self::purok($barangay),
        ];
    }

    /** Does the text carry any (or all) of the phrases that name this paper? */
    private static function looksLike(string $text, array $marks, bool $any): bool
    {
        $haystack = Str::lower(self::tidy($text));

        if ($haystack === '') {
            return false;
        }

        return $any
            ? Str::contains($haystack, $marks)
            : Str::containsAll($haystack, $marks);
    }

    /** Squeezes OCR's runs of spaces, keeping the line breaks. */
    private static function tidy(string $text): string
    {
        return trim(preg_replace('/[^\S\n]+/', ' ', $text) ?? '');
    }

    private static function middleName(string $text): ?string
    {
        if (! preg_match('/\bmiddle(?:\s*name)?\s*[:\-]?\s*([^\n]+)/i', $text, $matches)) {
            return null;
        }

        // A label printed next to the value on the same line is not a name.
        $value = preg_split('/\b(?:sex|first|last|family|given|maiden|suffix|birth|date)\b/i', $matches[1])[0];
        $value = preg_replace('/[^\p{L}\s\'\-]/u', ' ', $value) ?? '';
        $value = trim(preg_replace('/\s+/', ' ', $value) ?? '');

        if (mb_strlen($value) < 2 || mb_strlen($value) > 60) {
            return null;
        }

        return Str::title($value);
    }

    /** A real date of birth for someone old enough to register, or null. */
    private static function birthDate(string $text): ?string
    {
        $pattern = '/\b(?:date\s*of\s*birth|birth\s*date|birthdate|date\s*ng\s*kapanganakan'
            . '|petsa\s*ng\s*kapanganakan|born\s*on)\b\s*[:\-]?\s*([^\n]{1,60})/i';

        if (! preg_match($pattern, $text, $matches)) {
            return null;
        }

        $date = self::parseDate($matches[1]);

        if ($date === null) {
            return null;
        }

        return Carbon::parse($date)->age >= self::MINIMUM_AGE ? $date : null;
    }

    private static function parseDate(string $text): ?string
    {
        $months = implode('|', array_map(fn ($month) => $month . '[a-z]*', self::MONTHS));

        // 1965-04-09
        if (preg_match('/\b(\d{4})[-\/. ](\d{1,2})[-\/. ](\d{1,2})\b/', $text, $m)) {
            return self::date((int) $m[1], (int) $m[2], (int) $m[3]);
        }

        // 9 April 1965
        if (preg_match('/\b(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+(' . $months . ')[\s,.-]+(\d{4})\b/i', $text, $m)) {
            return self::date((int) $m[3], self::month($m[2]), (int) $m[1]);
        }

        // April 9, 1965
        if (preg_match('/\b(' . $months . ')[\s,.-]+(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+(\d{4})\b/i', $text, $m)) {
            return self::date((int) $m[3], self::month($m[1]), (int) $m[2]);
        }

        // 04/09/1965 - month first, the way PSA forms print it.
        if (preg_match('/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})\b/', $text, $m)) {
            return self::date((int) $m[3], (int) $m[1], (int) $m[2]);
        }

        return null;
    }

    private static function date(int $year, ?int $month, int $day): ?string
    {
        if ($month === null || ! checkdate($month, $day, $year)) {
            return null;
        }

        $date = sprintf('%04d-%02d-%02d', $year, $month, $day);

        return $date <= Carbon::today()->toDateString() ? $date : null;
    }

    private static function month(string $name): ?int
    {
        $index = array_search(Str::lower(substr($name, 0, 3)), self::MONTHS, true);

        return $index === false ? null : $index + 1;
    }

    private static function sex(string $text): ?string
    {
        // The value sits beside the label on a filled form and under it on a
        // printed one, so the gap between them may be a line break.
        $pattern = '/\b(?:sex|gender|kasarian)\b\s*[:\-]?\s*(male|female|lalaki|babae|m|f)\b/i';

        if (! preg_match($pattern, $text, $matches)) {
            return null;
        }

        $value = match (Str::lower($matches[1])) {
            'male', 'lalaki', 'm' => 'Male',
            'female', 'babae', 'f' => 'Female',
        };

        return in_array($value, SeniorCitizen::GENDERS, true) ? $value : null;
    }

    private static function purok(string $text): ?string
    {
        $spelled = implode('|', array_keys(self::SPELLED_NUMBERS));

        if (! preg_match('/\bpurok\b\s*(?:no\.?|number)?\s*[:\-]?\s*(\d{1,2}|' . $spelled . ')\b/i', $text, $matches)) {
            return null;
        }

        $value = Str::lower($matches[1]);
        $number = ctype_digit($value) ? (int) $value : (self::SPELLED_NUMBERS[$value] ?? null);
        $purok = $number === null ? null : 'Purok ' . $number;

        return $purok !== null && in_array($purok, SeniorCitizen::PUROKS, true) ? $purok : null;
    }
}
