"""Read-only comparison contract tests; no hosted database or service is used."""
from contextlib import ExitStack
from importlib.util import module_from_spec, spec_from_file_location
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch
from urllib.parse import parse_qs, urlsplit

spec=spec_from_file_location('neon_compare_runner',Path(__file__).resolve().parents[2]/'tools/windows-backup/neon_compare.py')
runner=module_from_spec(spec);spec.loader.exec_module(runner)


def config():
    return {'sourceUrl':'postgresql://fixture:source%40password@'+runner.shared.EXPECTED_HOST+':5432/'+runner.shared.EXPECTED_DATABASE,
            'targetUrl':'postgresql://fixture:target%40password@ep-fixture.us-west-2.aws.neon.tech:5432/neondb?sslmode=require&channel_binding=require'}


def inventory(rows=2):
    return {'tables':{'transaction_photos':{'columns':['id','image'],'rows':rows,'rows_sha256':'a'*64,'photo_blobs':3,'photo_bytes':291,'photo_blobs_sha256':'b'*64}}}


class CompareInputTests(unittest.TestCase):
    def test_bounded_exact_json_rejects_duplicates_extras_missing_and_controls(self):
        for payload in [b'[]',b'{}',b'not-json',b'{"sourceUrl":"x","sourceUrl":"y","targetUrl":"z"}',b'{"sourceUrl":"x","targetUrl":"y","extra":1}',b' '*(runner.MAX_INPUT_BYTES+1)]:
            with self.subTest(payload=payload[:40]),self.assertRaises(runner.CompareError):runner.read_config(io.BytesIO(payload))
        self.assertEqual(runner.read_config(io.BytesIO(json.dumps(config()).encode())),config())
        for value in ['\n', '%00', '%C2%85', '%FF', '%ZZ']:
            bad=config();bad['sourceUrl']=bad['sourceUrl'].replace('source%40password',value)
            with self.subTest(value=value),self.assertRaises(runner.CompareError):runner.normalize_urls(bad)
        for field in ['sourceUrl','targetUrl']:
            bad=config();bad[field]=None
            with self.subTest(field=field),self.assertRaises(runner.CompareError):runner.normalize_urls(bad)

    def test_normalizers_pin_source_and_neon_and_force_tls(self):
        source,target=runner.normalize_urls(config())
        self.assertEqual(urlsplit(source).hostname,runner.shared.EXPECTED_HOST)
        for uri in [source,target]:
            self.assertEqual(parse_qs(urlsplit(uri).query)['sslmode'],['verify-full'])
        self.assertEqual(parse_qs(urlsplit(target).query)['channel_binding'],['require'])
        for field,replacement in [('sourceUrl',config()['sourceUrl'].replace(runner.shared.EXPECTED_HOST,'foreign.example.test')),('sourceUrl',config()['sourceUrl']+'?hostaddr=127.0.0.1'),('targetUrl',config()['targetUrl'].replace('ep-fixture.','ep-fixture-pooler.')),('targetUrl',config()['targetUrl']+'&options=-c%20role%3Dother')]:
            bad=config();bad[field]=replacement
            with self.subTest(field=field),self.assertRaises(runner.CompareError):runner.normalize_urls(bad)

    def test_maintenance_http_is_fixed_https_bounded_and_exact_true(self):
        def probe(payload,status=200,url=None):
            response=MagicMock();response.status=status;response.geturl.return_value=url or runner.MAINTENANCE_URL;response.read.return_value=payload
            response.__enter__.return_value=response;opener=MagicMock();opener.open.return_value=response
            with patch.object(runner,'build_opener',return_value=opener):value=runner.maintenance_status()
            request=opener.open.call_args.args[0]
            self.assertEqual(request.full_url,runner.MAINTENANCE_URL)
            self.assertEqual(request.headers['Cache-control'],'no-cache')
            self.assertEqual(opener.open.call_args.kwargs['timeout'],20)
            if status==200 and (url is None or url==runner.MAINTENANCE_URL):
                self.assertEqual(response.read.call_args.args[0],runner.MAX_RESPONSE_BYTES+1)
            else:response.read.assert_not_called()
            return value
        self.assertTrue(probe(b'{"maintenance_mode":true}'))
        for body in [b'{"maintenance_mode":false}',b'{"maintenance_mode":1}',b'{"maintenance_mode":"true"}',b'{"maintenance_mode":true,"maintenance_mode":true}',b'not-json',b' '*(runner.MAX_RESPONSE_BYTES+1)]:
            self.assertFalse(probe(body))
        self.assertFalse(probe(b'{"maintenance_mode":true}',status=503))
        self.assertFalse(probe(b'{"maintenance_mode":true}',url='https://foreign.example.test/capabilities'))
        self.assertIsNone(runner._NoRedirect().redirect_request(None,None,302,'',{},'https://foreign.example.test'))


class CompareOutcomeTests(unittest.TestCase):
    def fixture(self,root,*,maintenance=(True,True),data_equal=True,schema_equal=True,sequence_equal=True,readonly=True,source_major=18,target_major=18,commit_failure=False,core_override=None):
        core=core_override or runner.shared.load_backup_module()
        sources=[]
        for major in [source_major,target_major]:
            connection=MagicMock()
            def execute(statement,major=major):
                result=Mock()
                if statement=='SHOW transaction_read_only':result.fetchone.return_value=('on' if readonly else 'off',)
                elif statement=='SHOW server_version_num':result.fetchone.return_value=(str(major*10000+6),)
                else:result.fetchone.return_value=None
                return result
            connection.execute.side_effect=execute
            context=MagicMock();context.__enter__.return_value=connection
            if commit_failure:context.__exit__.side_effect=RuntimeError('SYNTHETIC_PRIVATE_URL_AND_ROW')
            sources.append((context,connection))
        core._pg_connect=Mock(side_effect=[x[0] for x in sources])
        core.postgres_inventory=Mock(side_effect=[inventory(),inventory(2 if data_equal else 3)])
        schema=Mock(side_effect=[{'columns':['id']},{'columns':['id' if schema_equal else 'changed'] }])
        sequences=Mock(side_effect=[[['id_seq',2,True]],[['id_seq',2 if sequence_equal else 4,True]]])
        with ExitStack() as stack:
            stack.enter_context(patch.object(runner.shared,'load_backup_module',return_value=core))
            stack.enter_context(patch.object(runner.shared,'preflight',return_value=18))
            status=stack.enter_context(patch.object(runner,'maintenance_status',side_effect=maintenance))
            stack.enter_context(patch.object(runner,'schema_inventory',schema))
            stack.enter_context(patch.object(runner,'sequence_inventory',sequences))
            # Any libpq ambient routing options must be gone before normalization/IO.
            actual_connect=core._pg_connect
            def connect(uri):
                self.assertFalse(any(k.startswith('PG') for k in os.environ))
                return actual_connect(uri)
            core._pg_connect=Mock(side_effect=connect)
            report=runner.run_compare(config(),root/'vault')
        return report,core,sources,status

    def test_match_reads_both_snapshots_and_preserves_env_without_restore_or_write(self):
        with tempfile.TemporaryDirectory() as temporary,patch.dict(os.environ,{'PGHOST':'wrong','PGOPTIONS':'-c role=wrong'}):
            report,core,connections,status=self.fixture(Path(temporary))
            self.assertEqual(report['status'],'verified');self.assertEqual(report['code'],'OK')
            self.assertTrue(all(report[k] for k in runner.BOOL_FIELDS))
            self.assertEqual(report['sourceInventorySHA256'],report['targetInventorySHA256'])
            expected_source,expected_target=runner.normalize_urls(config())
            self.assertEqual(report['sourceIdentitySHA256'],core._pg_identity(expected_source))
            self.assertEqual(report['targetIdentitySHA256'],core._pg_identity(expected_target))
            self.assertNotEqual(report['sourceIdentitySHA256'],report['targetIdentitySHA256'])
            self.assertEqual(len(report['sourceIdentitySHA256']),64)
            self.assertNotIn('neon.tech',json.dumps(report))
            self.assertEqual((report['sourceTables'],report['sourceRows'],report['sourcePhotoBlobs']),(1,2,3))
            self.assertEqual(status.call_count,2)
            for _,connection in connections:
                calls=[c.args[0] for c in connection.execute.call_args_list]
                self.assertEqual(calls[0],'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                self.assertEqual(calls[-1],'SET LOCAL search_path = pg_catalog, public')
                self.assertTrue(all(s.startswith(('SET ','SHOW ')) for s in calls))
            self.assertEqual(os.environ['PGHOST'],'wrong')
            saved=json.loads((Path(temporary)/'vault/result/comparison.json').read_bytes())
            self.assertEqual(saved,report)
            self.assertEqual((Path(temporary)/'vault/result/comparison.json').stat().st_mode & 0o777,0o600)
            self.assertNotIn('password',json.dumps(report))

    def test_maintenance_required_before_any_db_connection_and_again_at_end(self):
        for values,connections in [((False,),0),((True,False),2)]:
            with self.subTest(values=values),tempfile.TemporaryDirectory() as temporary:
                report,core,_,_=self.fixture(Path(temporary),maintenance=values)
                self.assertEqual(report['status'],'failed');self.assertEqual(report['code'],'SOURCE_MAINTENANCE_REQUIRED')
                self.assertFalse(report['match']);self.assertFalse(report['sourceMaintenanceObserved'])
                self.assertEqual(core._pg_connect.call_count,connections)

    def test_data_schema_and_sequence_drift_are_separate_honest_different_outcomes(self):
        for kwargs,field in [({'data_equal':False},'dataMatched'),({'schema_equal':False},'schemaMatched'),({'sequence_equal':False},'sequenceMatched')]:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as temporary:
                report,_,_,_=self.fixture(Path(temporary),**kwargs)
                self.assertEqual(report['status'],'different');self.assertEqual(report['code'],'DATABASES_DIFFER')
                self.assertFalse(report['match']);self.assertFalse(report[field]);self.assertTrue(report['readOnly']);self.assertTrue(report['sourceMaintenanceObserved'])
                self.assertNotEqual(report['sourceInventorySHA256'],report['targetInventorySHA256'])

    def test_version_and_readonly_failures_never_claim_match(self):
        for kwargs,code in [({'readonly':False},'READ_ONLY_REQUIRED'),({'source_major':17},'SOURCE_VERSION_UNSUPPORTED'),({'target_major':17},'TARGET_VERSION_UNSUPPORTED')]:
            with self.subTest(code=code),tempfile.TemporaryDirectory() as temporary:
                report,core,_,_=self.fixture(Path(temporary),**kwargs)
                self.assertEqual(report['code'],code);self.assertEqual(report['status'],'failed');self.assertFalse(report['match'])
                core.postgres_inventory.assert_not_called()

    def test_connection_close_failure_cannot_leave_a_verified_outcome_or_secret(self):
        with tempfile.TemporaryDirectory() as temporary:
            report,_,_,_=self.fixture(Path(temporary),commit_failure=True)
            self.assertEqual(report['status'],'failed');self.assertFalse(report['match']);self.assertEqual(report['code'],'OPERATION_FAILED')
            self.assertNotIn('SYNTHETIC_PRIVATE',json.dumps(report))

    def test_report_destination_refuses_existing_results_and_symlinks(self):
        for symlink in [False,True]:
            with self.subTest(symlink=symlink),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);vault=root/'vault'
                if symlink:
                    (root/'outside').mkdir();vault.symlink_to(root/'outside',target_is_directory=True)
                else:
                    (vault/'result').mkdir(parents=True);(vault/'result/keep').write_text('existing')
                report,core,_,_=self.fixture(root)
                self.assertEqual(report['code'],'VAULT_UNSAFE' if symlink else 'RESULT_ALREADY_EXISTS')
                core._pg_connect.assert_not_called()

    def test_schema_and_sequence_queries_are_selects_with_identifier_quoting(self):
        connection=MagicMock();connection.execute.return_value.fetchall.return_value=[]
        result=runner.schema_inventory(connection)
        self.assertEqual(set(result),{'columns','constraints','indexes'})
        for call in connection.execute.call_args_list:self.assertTrue(call.args[0].lstrip().startswith('SELECT '))
        connection.reset_mock()
        self.assertEqual(runner.sequence_inventory(connection),[])
        self.assertTrue(connection.execute.call_args.args[0].lstrip().startswith('SELECT '))
        self.assertNotIn('nextval(',runner.SEQUENCES_QUERY)

    def test_report_write_failure_cannot_claim_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            # Fail only the final report writer; keep every comparison successful.
            core=runner.shared.load_backup_module()
            core._write_private=Mock(side_effect=PermissionError('PRIVATE_WRITE_ERROR'))
            report,_,_,_=self.fixture(Path(temporary),core_override=core)
            self.assertEqual(report['status'],'failed');self.assertEqual(report['code'],'REPORT_WRITE_FAILED');self.assertFalse(report['match'])
            self.assertNotIn('PRIVATE_WRITE_ERROR',json.dumps(report))

    def test_cli_exit_codes_and_invalid_input_are_safe(self):
        for status,match,code in [('verified',True,0),('different',False,2),('failed',False,1)]:
            with patch.object(runner.sys,'stdin',Mock(buffer=io.BytesIO(json.dumps(config()).encode()))),patch.object(runner,'run_compare',return_value={'status':status,'match':match}),patch('sys.stdout',new_callable=io.StringIO) as output:
                self.assertEqual(runner.main(),code)
        with patch.object(runner.sys,'stdin',Mock(buffer=io.BytesIO(b'{invalid-secret'))),patch('sys.stdout',new_callable=io.StringIO) as output:
            self.assertEqual(runner.main(),1);value=json.loads(output.getvalue());self.assertEqual(value['code'],'INPUT_INVALID');self.assertNotIn('invalid-secret',output.getvalue())


if __name__=='__main__':unittest.main()
